#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createReport } from './lib/report.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const report = createReport('Baselinecapture');
const inventoryPath = join(root, 'supabase/migration-inventory.json');
const reviewPath = join(root, 'supabase/baseline-capture-review.json');
const migrationQueryPath = join(root, 'tools/sql/capture-migrations-readonly.sql');
const schemaQueryPath = join(root, 'tools/sql/capture-project-schema-readonly.sql');
const allowedClasses = new Set(['DDL', 'DML', 'permissions', 'policy', 'function/view', 'other']);

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parse(path, code) {
  if (!existsSync(path)) {
    report.blocker(code, 'Påkrævet fil mangler', relative(root, path));
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    report.blocker(`${code}_JSON`, error.message, relative(root, path));
    return null;
  }
}

function stripSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function checkSelectOnly(path) {
  if (!existsSync(path)) {
    report.blocker('CAPTURE_QUERY_MISSING', 'Capturequery mangler', relative(root, path));
    return '';
  }
  const sql = readFileSync(path, 'utf8');
  const code = stripSql(sql).trim();
  if (!/^select\b/i.test(code)) report.blocker('CAPTURE_QUERY_NOT_SELECT', 'Capturequery skal starte med SELECT', relative(root, path));
  const forbidden = code.match(/\b(?:insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|call|do)\b/i);
  if (forbidden) report.blocker('CAPTURE_QUERY_WRITE', `Forbudt SQL-verb: ${forbidden[0]}`, relative(root, path));
  if (/\b(?:pg_sleep|dblink|lo_export|pg_write_file|pg_read_file)\s*\(/i.test(code)) {
    report.blocker('CAPTURE_QUERY_UNSAFE_FUNCTION', 'Capturequery bruger en forbudt sideeffekt-/filfunktion', relative(root, path));
  }
  return sql;
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

const inventory = parse(inventoryPath, 'CAPTURE_INVENTORY');
const review = parse(reviewPath, 'CAPTURE_REVIEW');
const migrationQuery = checkSelectOnly(migrationQueryPath);
const schemaQuery = checkSelectOnly(schemaQueryPath);

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (/(?:^|\/)(?:migration-statements|schema-catalog)\.raw\.json$|capture-manifest\.private\.json$/i.test(rel)) {
    report.blocker('CAPTURE_RAW_IN_REPO', 'Rå/private capturefiler må ikke ligge i repositoryet', rel);
  }
}

if (inventory && review) {
  if (review.format_version !== 1) report.blocker('CAPTURE_FORMAT', 'format_version skal være 1');
  if (review.project_ref !== inventory.project_ref) report.blocker('CAPTURE_PROJECT', 'Project ref matcher ikke inventaret');
  if (review.base_commit !== 'a576c70e0c9426fecf61237849602a5d939a396b') report.blocker('CAPTURE_BASE', 'Capturebasen er ændret');
  if (review.provenance?.raw_files_committed !== false) report.blocker('CAPTURE_RAW_CLAIM', 'Metadata skal bekræfte, at rå filer ikke er committet');
  if (review.provenance?.database_writes_performed !== false) report.blocker('CAPTURE_WRITE_CLAIM', 'Capture må ikke påstå databasewrites');
  if (!/not an official pg_dump archive/i.test(review.provenance?.schema_capture_kind || '')) {
    report.blocker('CAPTURE_PGDUMP_CLAIM', 'Katalogcapturen må ikke fremstilles som et officielt pg_dump-arkiv');
  }
  if (review.provenance?.migration_query_sha256 !== hash(migrationQuery)) report.blocker('CAPTURE_QUERY_HASH', 'Migrationsqueryens hash matcher ikke metadata');
  if (review.provenance?.schema_query_sha256 !== hash(schemaQuery)) report.blocker('CAPTURE_QUERY_HASH', 'Schemaqueryens hash matcher ikke metadata');

  const expected = new Map(inventory.migrations.map(item => [item.version, item]));
  const actual = review.migrations || [];
  if (actual.length !== expected.size) report.blocker('CAPTURE_COUNT', 'Antal reviewede migrationer matcher ikke inventaret');
  const seen = new Set();
  const recomputedClasses = Object.fromEntries([...allowedClasses].map(name => [name, 0]));
  let matching = 0;
  for (const item of actual) {
    const source = expected.get(item.version);
    const context = `${item.version || 'ukendt'}_${item.name || 'ukendt'}`;
    if (!source) report.blocker('CAPTURE_VERSION', 'Ukendt migration i reviewmetadata', context);
    if (seen.has(item.version)) report.blocker('CAPTURE_DUPLICATE', 'Dubleret migration i reviewmetadata', context);
    seen.add(item.version);
    if (source && item.name !== source.name) report.blocker('CAPTURE_NAME', 'Migrationsnavn matcher ikke inventaret', context);
    if (source && item.registered_md5 !== source.remote_statements_md5) report.blocker('CAPTURE_REGISTERED_HASH', 'Registreret MD5 matcher ikke inventaret', context);
    if (item.captured_md5 !== item.registered_md5 || item.fingerprint_match !== true) {
      report.blocker('CAPTURE_FINGERPRINT', 'Captured statement matcher ikke registreret fingerprint', context);
    } else matching += 1;
    if (!Array.isArray(item.classifications) || item.classifications.length === 0) report.blocker('CAPTURE_CLASSIFICATION', 'Migrationen mangler klassifikation', context);
    for (const name of item.classifications || []) {
      if (!allowedClasses.has(name)) report.blocker('CAPTURE_CLASSIFICATION', `Ukendt klassifikation: ${name}`, context);
      else recomputedClasses[name] += 1;
    }
    if (item.commit_status !== 'hold_raw_private') report.blocker('CAPTURE_COMMIT_STATUS', 'Rå SQL må ikke frigives til commit i denne fase', context);
    if (!['unsafe_unmodified', 'blocked_until_dependency_review'].includes(item.replay_status)) {
      report.blocker('CAPTURE_REPLAY_STATUS', 'Migrationen må ikke markeres replay-klar', context);
    }
  }

  const summary = review.fingerprint_summary || {};
  if (summary.expected !== expected.size || summary.captured !== actual.length || summary.matching !== matching || summary.all_match !== true) {
    report.blocker('CAPTURE_FINGERPRINT_SUMMARY', 'Fingerprintresumé matcher ikke migrationsrækkerne');
  }
  for (const [name, count] of Object.entries(recomputedClasses)) {
    if (review.classification_summary?.[name] !== count) report.blocker('CAPTURE_CLASS_SUMMARY', `Klassifikationsresumé er forkert for ${name}`);
  }
  if (review.security_summary?.statements_with_possible_credentials !== 0 || review.security_summary?.schema_possible_credentials !== false) {
    report.blocker('CAPTURE_CREDENTIAL_SIGNAL', 'Sanitiseret review rapporterer muligt credential');
  }
  if (review.chain_assessment?.creates_base_deals_table !== false || review.chain_assessment?.references_deals_table !== true || review.chain_assessment?.empty_database_replay_claim !== false) {
    report.blocker('CAPTURE_CHAIN_ASSESSMENT', 'Replaykædens dokumenterede basehul er blevet skjult');
  }

  const serialized = JSON.stringify(review);
  if (/\b(?:statements|rollback|created_by|idempotency_key)\s*:/i.test(serialized)) {
    report.blocker('CAPTURE_RAW_FIELD', 'Reviewmetadata indeholder et råt migrationsfelt');
  }
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bsb_secret_[A-Za-z0-9_-]+\b|postgres(?:ql)?:\/\/[^:\s"]+:[^@\s"]+@/i.test(serialized)) {
    report.blocker('CAPTURE_SECRET_CONTENT', 'Reviewmetadata ligner et credential');
  }
}

report.finish();
