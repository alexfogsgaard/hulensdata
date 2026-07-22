#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checker = join(root, 'tools/check-local-baseline-replay.mjs');
const fixture = mkdtempSync(join(tmpdir(), 'hulensdata-local-replay-check-'));

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

function mutateResult(mutation, code, label) {
  const path = join(fixture, 'supabase/baseline/local-replay-result.json');
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

try {
  for (const relativePath of [
    'supabase/baseline/local-replay-result.json',
    'supabase/baseline/project-schema-baseline.draft.sql',
    'supabase/baseline/project-schema-baseline.draft.inventory.json',
    'supabase/baseline/project-schema-acl.contract.draft.sql',
    'supabase/schema-dump-review.json',
    'tools/sql/local-baseline-preconditions.sql',
    'tools/sql/local-baseline-replay-fixture.sql',
  ]) {
    const destination = join(fixture, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, relativePath), destination);
  }
  assert.equal(run().status, 0, `Baselinecheck skulle være grønt\n${output(run())}`);

  mutateResult(value => { value.provenance.production_connections = 1; }, 'LOCAL_REPLAY_ISOLATION', 'productionforbindelse');
  mutateResult(value => { value.replay.deterministic_final_schema = false; }, 'LOCAL_REPLAY_DETERMINISM', 'ikke-deterministisk schema');
  mutateResult(value => { value.replay.schema_review_all_match = false; }, 'LOCAL_REPLAY_SCHEMA_DIFF', 'schemaforskel');
  mutateResult(value => { value.security_tests.rls_enabled_tables.pop(); }, 'LOCAL_REPLAY_RLS', 'manglende RLS');
  mutateResult(value => { value.security_tests.negative_writes_denied = 47; }, 'LOCAL_REPLAY_WRITE_ACCESS', 'uventet write-adgang');
  mutateResult(value => { value.security_definer_review.observed_after_acl.anon_execute = true; }, 'LOCAL_REPLAY_FUNCTION_RECOMMENDATION', 'anon EXECUTE på definerfunktion');
  mutateResult(value => { value.inputs.baseline_sha256 = '0'.repeat(64); }, 'LOCAL_REPLAY_INPUT_HASH', 'ændret baselinefingerprint');
  mutateText('supabase/baseline/project-schema-acl.contract.draft.sql', sql => `${sql}\nGRANT INSERT ON public.companies TO anon;\n`, 'LOCAL_REPLAY_ACL_SQL', 'write-grant i ACL');

  const artifactPath = join(fixture, 'private/cluster/PG_VERSION');
  try {
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, '17\n');
    assertBlocked('LOCAL_REPLAY_ARTIFACT', 'lokal clusterfil i repository');
  } finally {
    rmSync(join(fixture, 'private'), { recursive: true, force: true });
  }

  assert.equal(run().status, 0, 'Alle mutationer skulle være gendannet');
  console.log('Lokal replay-værn: 9 mutationer blokeret · alle fixtures gendannet');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
