#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createReport } from './lib/report.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const report = createReport('Databasefundament');
const supabaseRoot = join(root, 'supabase');
const inventoryPath = join(supabaseRoot, 'migration-inventory.json');
const migrationsRoot = join(supabaseRoot, 'migrations');
const VERSION = /^\d{14}$/;
const NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SQL_NAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

function parseInventory() {
  if (!existsSync(inventoryPath)) {
    report.blocker('DB_INVENTORY_MISSING', 'Migrationsinventaret mangler', relative(root, inventoryPath));
    return null;
  }
  try {
    return JSON.parse(readFileSync(inventoryPath, 'utf8'));
  } catch (error) {
    report.blocker('DB_INVENTORY_JSON', error.message, relative(root, inventoryPath));
    return null;
  }
}

function walk(path, files = []) {
  if (!existsSync(path)) return files;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child, files);
    else files.push(child);
  }
  return files;
}

const inventory = parseInventory();
if (inventory) {
  const allowedKeys = new Set([
    'format_version', 'project_ref', 'captured_at', 'source', 'baseline_status',
    'history_replayable', 'remote_head', 'migrations',
  ]);
  for (const key of Object.keys(inventory)) {
    if (!allowedKeys.has(key)) report.blocker('DB_INVENTORY_FIELD', `Ukendt topfelt: ${key}`);
  }

  if (inventory.format_version !== 1) report.blocker('DB_INVENTORY_VERSION', 'format_version skal være 1');
  if (!/^[a-z0-9]{20}$/.test(inventory.project_ref || '')) report.blocker('DB_PROJECT_REF', 'project_ref har ugyldigt format');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inventory.captured_at || '') || Number.isNaN(Date.parse(`${inventory.captured_at}T00:00:00Z`))) {
    report.blocker('DB_CAPTURE_DATE', 'captured_at skal være en gyldig ISO-dato');
  }
  if (inventory.baseline_status !== 'inventory_only_not_replayable') {
    report.blocker('DB_BASELINE_STATUS', 'Kun den dokumenterede inventory-only-status er tilladt før baseline-review');
  }
  if (inventory.history_replayable !== false) {
    report.blocker('DB_REPLAYABLE_CLAIM', 'Historikken må ikke markeres replaybar, før en isoleret restore er bevist');
  }
  if (!Array.isArray(inventory.migrations) || inventory.migrations.length === 0) {
    report.blocker('DB_MIGRATIONS_EMPTY', 'Inventaret skal indeholde den observerede migrationshistorik');
  } else {
    const versions = new Set();
    let previous = '';
    for (const [index, migration] of inventory.migrations.entries()) {
      const context = `migrations[${index}]`;
      const keys = Object.keys(migration).sort().join(',');
      if (keys !== 'body_status,name,remote_statement_count,remote_statements_md5,version') {
        report.blocker('DB_MIGRATION_FIELD', 'Migrationen skal have version, name, body_status og remote statement-fingeraftryk', context);
      }
      if (!VERSION.test(migration.version || '')) report.blocker('DB_MIGRATION_VERSION', 'Version skal være 14 cifre', context);
      if (!NAME.test(migration.name || '')) report.blocker('DB_MIGRATION_NAME', 'Navn skal være lille snake_case', context);
      if (migration.body_status !== 'stored_remote_not_reviewed') report.blocker('DB_MIGRATION_BODY_STATUS', 'Historisk SQL må ikke påstås versioneret uden review', context);
      if (!Number.isInteger(migration.remote_statement_count) || migration.remote_statement_count < 1) {
        report.blocker('DB_MIGRATION_STATEMENT_COUNT', 'Remote statement-antal skal være et positivt heltal', context);
      }
      if (!/^[a-f0-9]{32}$/.test(migration.remote_statements_md5 || '')) {
        report.blocker('DB_MIGRATION_STATEMENT_HASH', 'Remote statement-MD5 har ugyldigt format', context);
      }
      if (versions.has(migration.version)) report.blocker('DB_MIGRATION_DUPLICATE', `Dubleret version ${migration.version}`, context);
      if (previous && migration.version <= previous) report.blocker('DB_MIGRATION_ORDER', 'Migrationerne skal være strengt stigende', context);
      versions.add(migration.version);
      previous = migration.version;
    }
    const last = inventory.migrations.at(-1)?.version;
    if (inventory.remote_head !== last) report.blocker('DB_REMOTE_HEAD', 'remote_head matcher ikke sidste observerede migration');
  }
}

if (!existsSync(migrationsRoot)) {
  report.blocker('DB_MIGRATIONS_DIR', 'supabase/migrations mangler');
} else {
  const sqlFiles = readdirSync(migrationsRoot).filter(name => name.endsWith('.sql'));
  for (const file of sqlFiles) {
    if (!SQL_NAME.test(file)) report.blocker('DB_SQL_FILENAME', 'SQL-filnavn skal følge YYYYMMDDHHMMSS_snake_case.sql', file);
    const sql = readFileSync(join(migrationsRoot, file), 'utf8');
    if (!sql.trim() || /\b(?:TODO|PLACEHOLDER)\b/i.test(sql)) {
      report.blocker('DB_SQL_PLACEHOLDER', 'Tomme eller markerede placeholder-migrationer er forbudt', file);
    }
  }
  if (sqlFiles.length > 0 && inventory?.history_replayable === false) {
    report.blocker('DB_SQL_BEFORE_BASELINE', 'SQL-filer må først tilføjes, når baseline-status er reviewet og kontrakten opdateret');
  }
}

for (const forbidden of ['.temp', '.branches']) {
  if (existsSync(join(supabaseRoot, forbidden))) report.blocker('DB_LOCAL_STATE_TRACKED', `Lokal Supabase-state må ikke ligge i fundamentet: ${forbidden}`);
}

const sensitiveName = /(^|\/)(?:\.env(?:\..*)?|.*\.pem|.*\.key)$/i;
const sensitiveContent = [
  /SUPABASE_(?:DB_PASSWORD|SERVICE_ROLE_KEY)\s*=/i,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
  /\bservice_role\b[^\n]{0,40}\beyJ[A-Za-z0-9_-]+\./i,
];
for (const file of walk(supabaseRoot)) {
  const rel = relative(supabaseRoot, file);
  if (lstatSync(file).isSymbolicLink()) {
    report.blocker('DB_SYMLINK', 'Symlinks er ikke tilladt under supabase/', rel);
    continue;
  }
  if (sensitiveName.test(rel)) report.blocker('DB_CREDENTIAL_FILE', 'Credential-/nøglefil må ikke ligge under supabase/', rel);
  const content = readFileSync(file, 'utf8');
  if (sensitiveContent.some(pattern => pattern.test(content))) report.blocker('DB_CREDENTIAL_CONTENT', 'Muligt databasecredential fundet', rel);
}

if (inventory?.history_replayable === false) {
  report.info('DB_BASELINE_PENDING', 'Inventaret er afstemt, men repository-historikken er bevidst ikke replaybar endnu');
}

report.finish();
