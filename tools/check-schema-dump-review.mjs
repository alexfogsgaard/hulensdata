#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createReport } from './lib/report.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const report = createReport('Schema-dump-review');
const reviewPath = join(root, 'supabase/schema-dump-review.json');

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

function allZero(object) {
  return object && Object.values(object).every(value => Number(value) === 0);
}

function checkCount(name, values, expected) {
  if (!Array.isArray(values) || values.length !== expected) {
    report.blocker('SCHEMA_DUMP_OBJECT_COUNT', `${name} skal indeholde ${expected} objekter`);
  }
}

let review = null;
if (!existsSync(reviewPath)) {
  report.blocker('SCHEMA_DUMP_REVIEW_MISSING', 'Sanitiseret schema-dump-review mangler', relative(root, reviewPath));
} else {
  try {
    review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  } catch (error) {
    report.blocker('SCHEMA_DUMP_REVIEW_JSON', error.message, relative(root, reviewPath));
  }
}

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (/(?:^|\/)(?:\.pgpass(?:\..*)?|.*\.raw\.sql|.*\.dump|production-schema-only\.pg_dump\.log)$/i.test(rel)) {
    report.blocker('SCHEMA_DUMP_PRIVATE_FILE', 'Credential, rå dump eller privat log må ikke ligge i repositoryet', rel);
  }
}

if (review) {
  if (review.format_version !== 1) report.blocker('SCHEMA_DUMP_FORMAT', 'format_version skal være 1');
  if (review.base_commit !== 'bfd621886dd78cf7744d2e3c9db27843b693f14f') report.blocker('SCHEMA_DUMP_BASE', 'Forkert review-base');
  if (review.project_ref !== 'upaxzfytumsijnbhjihd') report.blocker('SCHEMA_DUMP_PROJECT', 'Forkert project ref');
  if (review.provenance?.database_operation_count !== 1) report.blocker('SCHEMA_DUMP_OPERATION_COUNT', 'Præcis ét schema-dump skal være dokumenteret');
  if (review.provenance?.database_operations?.join(',') !== 'pg_dump --schema-only') report.blocker('SCHEMA_DUMP_OPERATION', 'Kun pg_dump --schema-only må være dokumenteret');
  if (review.provenance?.database_writes_performed !== false || review.provenance?.remote_state_changes !== false) {
    report.blocker('SCHEMA_DUMP_WRITE', 'Reviewet må ikke dokumentere writes eller remote-state-ændring');
  }
  if (review.provenance?.migrations_commands_performed !== false || review.provenance?.replay_performed !== false) {
    report.blocker('SCHEMA_DUMP_MIGRATION', 'Migration/replay er ikke tilladt');
  }
  if (review.provenance?.raw_files_committed !== false || review.provenance?.private_paths_committed !== false) {
    report.blocker('SCHEMA_DUMP_RAW_CLAIM', 'Rå filer og private paths skal være ucommittede');
  }
  const flags = new Set(review.provenance?.dump_flags || []);
  for (const flag of ['--schema-only', '--no-owner', '--no-privileges']) {
    if (!flags.has(flag)) report.blocker('SCHEMA_DUMP_FLAG', `Dumpflag mangler: ${flag}`);
  }
  if (review.provenance?.connection?.sslmode !== 'verify-full') report.blocker('SCHEMA_DUMP_TLS', 'TLS skal være verify-full');
  if (review.provenance?.connection?.default_transaction_read_only !== true) report.blocker('SCHEMA_DUMP_READ_ONLY', 'Sessionens default_transaction_read_only skal være dokumenteret');
  if (review.versions?.pg_dump !== '17.10' || !/^17\./.test(review.versions?.server || '')) {
    report.blocker('SCHEMA_DUMP_VERSION', 'pg_dump 17.10 og PostgreSQL 17-server skal være dokumenteret');
  }
  if (!review.private_artifacts?.dump?.mode_private || !review.private_artifacts?.log?.mode_private) {
    report.blocker('SCHEMA_DUMP_MODE', 'Private artefakter skal være ejerbeskyttede');
  }
  if (review.private_artifacts?.log?.warning_count !== 0 || review.private_artifacts?.log?.failure_count !== 0) {
    report.blocker('SCHEMA_DUMP_LOG', 'Dump-loggen skal være uden warnings/failures');
  }

  const scan = review.safety_scan || {};
  if (!allZero(scan.data_signals)) report.blocker('SCHEMA_DUMP_DATA', 'Schema-dumpet rapporterer tabeldata');
  if (!allZero(scan.credential_signals)) report.blocker('SCHEMA_DUMP_CREDENTIAL', 'Schema-dumpet rapporterer muligt credential');
  if (!allZero(scan.personal_data_signals)) report.blocker('SCHEMA_DUMP_PERSONAL_DATA', 'Schema-dumpet rapporterer mulig persondata');
  if (!allZero(scan.role_and_acl_signals)) report.blocker('SCHEMA_DUMP_ROLE_ACL', 'Dumpet skal udelade custom roles, owners og ACL-statements');
  if (review.safety_summary?.raw_dump_safe_to_commit !== false) report.blocker('SCHEMA_DUMP_COMMIT_STATUS', 'Rå dump må aldrig markeres commit-klar');

  const inventory = review.object_inventory || {};
  const project = inventory.project_schema || {};
  checkCount('tabeller', project.tables, 8);
  checkCount('tabelkolonner', project.columns, 59);
  checkCount('sequences', project.sequences, 5);
  checkCount('views', project.views, 1);
  checkCount('funktioner', project.functions, 1);
  checkCount('triggers', project.triggers, 3);
  checkCount('selvstændige indeks', project.indexes, 7);
  checkCount('constraints', project.constraints, 26);
  checkCount('policies', project.policies, 8);
  checkCount('RLS-tabeller', project.row_security, 8);
  const typeTotal = Object.values(inventory.by_type || {}).reduce((sum, value) => sum + value, 0);
  const schemaTotal = Object.values(inventory.by_schema || {}).reduce((sum, value) => sum + value, 0);
  if (typeTotal !== inventory.header_count || schemaTotal !== inventory.header_count) {
    report.blocker('SCHEMA_DUMP_SUMMARY', 'Objektresumé summerer ikke til header_count');
  }

  const comparison = review.catalog_comparison || {};
  if (comparison.all_project_objects_match !== true) report.blocker('SCHEMA_DUMP_DIFF', 'Project-objekter matcher ikke katalogcapturen');
  if (comparison.extensions_match_with_documented_builtin_exception !== true) report.blocker('SCHEMA_DUMP_EXTENSION_DIFF', 'Extensions matcher ikke den dokumenterede plpgsql-undtagelse');
  for (const [name, result] of Object.entries(comparison.comparisons || {})) {
    if (result.match !== true) report.blocker('SCHEMA_DUMP_DIFF', `Uforklaret objektdiff: ${name}`);
  }
  const extensionDiff = comparison.comparisons?.extensions;
  if (JSON.stringify(extensionDiff?.allowed_missing) !== JSON.stringify(['plpgsql'])) {
    report.blocker('SCHEMA_DUMP_EXTENSION_EXCEPTION', 'Kun plpgsql må være dokumenteret som forventet manglende dumpobjekt');
  }
  if (comparison.catalog_acl_inventory?.relation_privilege_entries !== 348 || comparison.catalog_acl_inventory?.default_acl_entries !== 300) {
    report.blocker('SCHEMA_DUMP_ACL_INVENTORY', 'ACL-inventaret matcher ikke katalogcapturen');
  }
  const expectedOwners = {
    'event_triggers:postgres': 1,
    'event_triggers:supabase_admin': 6,
    'extensions:postgres': 3,
    'extensions:supabase_admin': 3,
    'functions:postgres': 1,
    'publications:postgres': 1,
    'relations:postgres': 14,
    'schemas:pg_database_owner': 1,
  };
  if (JSON.stringify(comparison.catalog_owner_inventory) !== JSON.stringify(expectedOwners)) {
    report.blocker('SCHEMA_DUMP_OWNER_INVENTORY', 'Owner-inventaret matcher ikke katalogcapturen');
  }

  if (review.baseline_gate?.status !== 'ready_for_sanitized_baseline_draft_in_separate_phase') {
    report.blocker('SCHEMA_DUMP_GATE', 'Reviewet må kun åbne en separat sanitiseret draftfase');
  }
  if (review.baseline_gate?.baseline_sql_committed !== false || review.baseline_gate?.replay_authorized !== false || review.baseline_gate?.remote_history_alignment_authorized !== false) {
    report.blocker('SCHEMA_DUMP_REPLAY', 'Baseline, replay og remote history alignment skal forblive uautoriseret');
  }

  const serialized = JSON.stringify(review);
  if (/\/Users\/|private-captures|\.pgpass/i.test(serialized)) report.blocker('SCHEMA_DUMP_PRIVATE_PATH', 'Sanitiseret metadata indeholder en privat path');
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bsb_secret_[A-Za-z0-9_-]+\b|postgres(?:ql)?:\/\/[^:\s"]+:[^@\s"]+@/i.test(serialized)) {
    report.blocker('SCHEMA_DUMP_SECRET_CONTENT', 'Sanitiseret metadata ligner et credential');
  }
  if (/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|FUNCTION|ROLE)\b/i.test(serialized)) {
    report.blocker('SCHEMA_DUMP_RAW_SQL', 'Sanitiseret metadata må ikke indeholde baseline-/dump-SQL');
  }
}

report.finish();
