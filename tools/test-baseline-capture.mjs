#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'hulensdata-baseline-capture-'));
const checker = join(root, 'tools/check-baseline-capture.mjs');
const analyzer = join(root, 'tools/analyze-baseline-capture.mjs');

function run() {
  return spawnSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function assertBlocked(code, label) {
  const result = run();
  assert.notEqual(result.status, 0, `${label} skulle give non-zero exit`);
  assert.match(output(result), new RegExp(`\\b${code}\\b`), `${label} skulle rapportere ${code}`);
}

function mutateJson(relativePath, mutation, code, label) {
  const path = join(fixture, relativePath);
  const original = readFileSync(path, 'utf8');
  try {
    const value = JSON.parse(original);
    mutation(value);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    assertBlocked(code, label);
  } finally {
    writeFileSync(path, original);
  }
}

function mutateText(relativePath, mutation, code, label) {
  const path = join(fixture, relativePath);
  const original = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, mutation(original));
    assertBlocked(code, label);
  } finally {
    writeFileSync(path, original);
  }
}

function md5(value) {
  return createHash('md5').update(value).digest('hex');
}

function runAnalyzerFixture(sql) {
  const dir = join(fixture, 'analyzer-fixture');
  mkdirSync(dir, { recursive: true });
  const migration = {
    version: '20260722000000',
    name: 'synthetic_capture_fixture',
    statements: [sql],
    rollback: [],
    created_by: 'synthetic',
    idempotency_key: null,
  };
  const raw = {
    capture_version: 1,
    captured_at: '2026-07-22T00:00:00Z',
    project_ref: 'upaxzfytumsijnbhjihd',
    migrations: [migration],
  };
  const inventory = {
    project_ref: raw.project_ref,
    migrations: [{
      version: migration.version,
      name: migration.name,
      remote_statements_md5: md5(sql),
    }],
  };
  const schema = {
    captured_at: raw.captured_at,
    relations: [], columns: [], constraints: [], indexes: [], sequences: [],
    views: [], functions: [], triggers: [], policies: [], relation_privileges: [],
    default_acl: [], extensions: [], event_triggers: [], publications: [],
    server: { version: '17.6' },
  };
  const paths = {
    migrations: join(dir, 'migrations.json'),
    schema: join(dir, 'schema.json'),
    inventory: join(dir, 'inventory.json'),
    migrationQuery: join(dir, 'migrations.sql'),
    schemaQuery: join(dir, 'schema.sql'),
    output: join(dir, 'output.json'),
    manifest: join(dir, 'manifest.json'),
  };
  writeFileSync(paths.migrations, JSON.stringify(raw));
  writeFileSync(paths.schema, JSON.stringify(schema));
  writeFileSync(paths.inventory, JSON.stringify(inventory));
  writeFileSync(paths.migrationQuery, 'select 1;\n');
  writeFileSync(paths.schemaQuery, 'select 1;\n');
  const result = spawnSync(process.execPath, [
    analyzer,
    '--migrations', paths.migrations,
    '--schema', paths.schema,
    '--inventory', paths.inventory,
    '--migration-query', paths.migrationQuery,
    '--schema-query', paths.schemaQuery,
    '--output', paths.output,
    '--private-manifest', paths.manifest,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Analyzerfixture fejlede\n${output(result)}`);
  return JSON.parse(readFileSync(paths.output, 'utf8'));
}

try {
  cpSync(join(root, 'supabase'), join(fixture, 'supabase'), { recursive: true });
  cpSync(join(root, 'tools/sql'), join(fixture, 'tools/sql'), { recursive: true });
  const baseline = run();
  assert.equal(baseline.status, 0, `Baseline skulle være grøn\n${output(baseline)}`);

  mutateJson('supabase/baseline-capture-review.json', value => { value.migrations[0].captured_md5 = '0'.repeat(32); },
    'CAPTURE_FINGERPRINT', 'ændret statementfingerprint');
  mutateJson('supabase/baseline-capture-review.json', value => { value.provenance.raw_files_committed = true; },
    'CAPTURE_RAW_CLAIM', 'falsk raw-commitpåstand');
  mutateJson('supabase/baseline-capture-review.json', value => { value.migrations[0].replay_status = 'safe'; },
    'CAPTURE_REPLAY_STATUS', 'ubevist replayklar migration');
  mutateJson('supabase/baseline-capture-review.json', value => { value.chain_assessment.creates_base_deals_table = true; },
    'CAPTURE_CHAIN_ASSESSMENT', 'skjult basehul');
  mutateText('tools/sql/capture-migrations-readonly.sql', sql => `${sql}\ndrop table public.deals;\n`,
    'CAPTURE_QUERY_WRITE', 'write-verb i capturequery');

  const rawPath = join(fixture, 'migration-statements.raw.json');
  try {
    writeFileSync(rawPath, '{}\n');
    assertBlocked('CAPTURE_RAW_IN_REPO', 'rå capturefil i repo');
  } finally {
    rmSync(rawPath, { force: true });
  }

  const cleanAnalysis = runAnalyzerFixture('create table public.example (id bigint);');
  assert.equal(cleanAnalysis.security_summary.statements_with_possible_credentials, 0, 'Ren fixture skulle ikke give credentialfund');
  const sensitiveAnalysis = runAnalyzerFixture("insert into investors (canonical_name) values ('Person Name'); select 'postgres://user:password@host/db';");
  assert.equal(sensitiveAnalysis.security_summary.statements_with_possible_credentials, 1, 'Credential-URI skulle opdages');
  assert.equal(sensitiveAnalysis.security_summary.statements_with_personal_or_public_person_data, 1, 'Persondatafixture skulle opdages');
  assert.equal(sensitiveAnalysis.security_summary.statements_with_dml, 1, 'DML-fixture skulle opdages');

  assert.equal(run().status, 0, 'Alle mutationer skulle være gendannet');
  console.log('Baselinecapture-værn: 6 mutationer blokeret · SELECT-only queries · secret/persondata/DML-scan bevist · 16 fingerprints · alle fixtures gendannet');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
