#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checker = join(root, 'tools/check-database-foundation.mjs');
const fixture = mkdtempSync(join(tmpdir(), 'hulensdata-db-foundation-'));

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

function mutateInventory(mutation, code, label) {
  const path = join(fixture, 'supabase/migration-inventory.json');
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

try {
  cpSync(join(root, 'supabase'), join(fixture, 'supabase'), { recursive: true });
  const baseline = run();
  assert.equal(baseline.status, 0, `Baseline skulle være grøn\n${output(baseline)}`);

  mutateInventory(value => value.migrations.push({ ...value.migrations.at(-1) }),
    'DB_MIGRATION_DUPLICATE', 'dubleret migrationsversion');
  mutateInventory(value => { value.remote_head = '20000101000000'; },
    'DB_REMOTE_HEAD', 'forkert remote head');
  mutateInventory(value => { value.history_replayable = true; },
    'DB_REPLAYABLE_CLAIM', 'ubevist replayability');

  const sqlPath = join(fixture, 'supabase/migrations/20260722000000_placeholder.sql');
  try {
    writeFileSync(sqlPath, '-- TODO: reconstruct later\n');
    assertBlocked('DB_SQL_PLACEHOLDER', 'tom historisk placeholder');
  } finally {
    rmSync(sqlPath, { force: true });
  }

  const credentialPath = join(fixture, 'supabase/.env');
  try {
    writeFileSync(credentialPath, 'SUPABASE_DB_PASSWORD=test-only-value\n');
    assertBlocked('DB_CREDENTIAL_FILE', 'credential-fil');
  } finally {
    rmSync(credentialPath, { force: true });
  }

  assert.equal(run().status, 0, 'Alle mutationer skulle være gendannet');
  console.log('Databasefundament-værn: 5 mutationer blokeret · baseline grøn · alle fixtures gendannet');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
