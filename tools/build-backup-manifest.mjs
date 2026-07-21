#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorialError, scanSecrets, sha256 } from './lib/editorial-files.mjs';
import { validateManifestShape } from './lib/editorial-contracts.mjs';
import { assertBackupReferences } from './verify-backup-manifest.mjs';

const TABLES = ['seasons', 'investors', 'panel_memberships', 'companies', 'deals', 'deal_investors', 'company_events', 'sources'];
const VIEW = 'investor_status';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new EditorialError('CLI_USAGE', `Mangler ${name}`);
  return value;
}

function inspectJson(dir, objectName, kind) {
  const relative_path = `${objectName}.json`;
  const file = join(dir, relative_path);
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new EditorialError('BACKUP_FILE_TYPE', 'Eksportfil skal være en almindelig fil', relative_path);
  const bytes = readFileSync(file);
  scanSecrets(bytes.toString('utf8'), relative_path);
  let rows;
  try { rows = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new EditorialError('BACKUP_JSON', `Ugyldig JSON: ${error.message}`, relative_path); }
  if (!Array.isArray(rows)) throw new EditorialError('BACKUP_JSON_TYPE', 'Tabel/view-eksport skal være et array', relative_path);
  return {
    artifact: { kind, object_name: objectName, relative_path, sha256: sha256(bytes), bytes: bytes.length, rows: rows.length, query: null, content_range_total: null },
    rows,
  };
}

export function buildBackupManifest(dir, metadata) {
  const absolute = resolve(dir);
  const artifacts = [];
  const data = {};
  const missing = [];
  for (const table of TABLES) {
    try {
      const inspected = inspectJson(absolute, table, 'table_json');
      artifacts.push(inspected.artifact);
      data[table] = inspected.rows;
    } catch (error) {
      if (error.code === 'ENOENT') missing.push(`${table}.json`);
      else throw error;
    }
  }
  try { artifacts.push(inspectJson(absolute, VIEW, 'view_json').artifact); }
  catch (error) { if (error.code === 'ENOENT') missing.push(`${VIEW}.json`); else throw error; }

  const migrationsFile = join(absolute, 'schema-migrations.txt');
  try {
    const info = lstatSync(migrationsFile);
    if (info.isSymbolicLink() || !info.isFile()) throw new EditorialError('BACKUP_FILE_TYPE', 'Migrationslisten skal være en almindelig fil', 'schema-migrations.txt');
    const bytes = readFileSync(migrationsFile);
    scanSecrets(bytes.toString('utf8'), 'schema-migrations.txt');
    artifacts.push({ kind: 'migration_list', object_name: null, relative_path: 'schema-migrations.txt', sha256: sha256(bytes), bytes: bytes.length, rows: null, query: null, content_range_total: null });
  } catch (error) {
    if (error.code === 'ENOENT') missing.push('schema-migrations.txt');
    else throw error;
  }

  let referencesOk = false;
  if (!TABLES.some(table => !data[table])) {
    assertBackupReferences(data);
    referencesOk = true;
  }
  const complete = missing.length === 0;
  const manifest = {
    schema_version: '1.0.0',
    backup_id: metadata.backup_id,
    created_at: metadata.created_at,
    status: complete ? 'complete' : 'failed',
    backup_scope: 'data_export',
    source: {
      provider: 'supabase', project_ref: metadata.project_ref, environment: metadata.environment,
      database_version: metadata.database_version, read_role: metadata.read_role,
    },
    tool: { name: 'hulensdata-backup-manifest', version: '1.0.0' },
    consistency: 'sequential_per_table',
    published_snapshot_sha256: metadata.published_snapshot_sha256 || null,
    migration_head: metadata.migration_head,
    git_sha: metadata.git_sha,
    artifacts: artifacts.sort((a, b) => a.relative_path.localeCompare(b.relative_path, 'en')),
    restore_order: [...TABLES],
    verification: {
      verified_at: metadata.verified_at,
      hashes_ok: complete,
      json_parse_ok: complete,
      row_counts_ok: complete,
      references_ok: complete && referencesOk,
      restore_rehearsed: false,
      restore_rehearsed_at: null,
      notes: complete
        ? 'Dataeksport verificeret. Ikke et fuldt database-recovery-set; eksporten er sekventiel pr. tabel.'
        : `Ufuldstændig dataeksport; mangler: ${missing.join(', ')}`,
    },
  };
  validateManifestShape(manifest);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const manifest = buildBackupManifest(requiredOption('--backup-dir'), {
      backup_id: requiredOption('--backup-id'),
      created_at: requiredOption('--created-at'),
      verified_at: requiredOption('--verified-at'),
      project_ref: requiredOption('--project-ref'),
      database_version: requiredOption('--database-version'),
      environment: option('--environment', 'production'),
      read_role: option('--read-role', 'anon'),
      migration_head: requiredOption('--migration-head'),
      git_sha: requiredOption('--git-sha'),
      published_snapshot_sha256: option('--published-snapshot-sha256'),
    });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    if (manifest.status !== 'complete') process.exitCode = 1;
  } catch (error) {
    console.error(`[BLOCKER] ${error.code || 'BACKUP_ERROR'}: ${error.message}${error.context ? ` (${error.context})` : ''}`);
    process.exitCode = 1;
  }
}
