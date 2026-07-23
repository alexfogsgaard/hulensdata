#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'hulensdata-promotion-replay-'));
const checker = join(root, 'tools/check-baseline-promotion-replay.mjs');
const resultPath = join(fixture, 'supabase/baseline/promotion-candidate-local-replay-result.json');

function run() {
  return spawnSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
}

function output(value) {
  return `${value.stdout || ''}${value.stderr || ''}`;
}

function assertBlocked(code, label) {
  const result = run();
  assert.notEqual(result.status, 0, `${label} skulle give non-zero exit`);
  assert.match(output(result), new RegExp(`\\b${code}\\b`), `${label} skulle rapportere ${code}`);
}

function mutateResult(mutate, code, label) {
  const original = readFileSync(resultPath, 'utf8');
  try {
    const value = JSON.parse(original);
    mutate(value);
    writeFileSync(resultPath, `${JSON.stringify(value, null, 2)}\n`);
    assertBlocked(code, label);
  } finally {
    writeFileSync(resultPath, original);
  }
}

try {
  for (const relativePath of [
    'supabase/baseline/promotion-candidate-local-replay-result.json',
    'supabase/baseline/project-schema-baseline.promotion-candidate.sql',
    'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json',
    'supabase/baseline/project-schema-baseline.draft.sql',
    'supabase/schema-dump-review.json',
    'tools/sql/local-baseline-preconditions.sql',
    'tools/sql/local-baseline-replay-fixture.sql',
  ]) {
    const target = join(fixture, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, relativePath), target);
  }
  assert.equal(run().status, 0, `Promotion-replay-check skulle være grøn\n${output(run())}`);

  mutateResult(value => { value.provenance.production_connections = 1; }, 'PROMOTION_REPLAY_ISOLATION', 'productionforbindelse');
  mutateResult(value => { value.replay.run_schema_sha256[1] = '0'.repeat(64); }, 'PROMOTION_REPLAY_DETERMINISM', 'afvigende schemahash');
  mutateResult(value => { value.replay.expected_difference_from_production_capture.other_object_differences.push('table'); }, 'PROMOTION_REPLAY_OBJECT_DIFF', 'uventet objektforskel');
  mutateResult(value => { value.security_tests.rls_enabled_tables.pop(); }, 'PROMOTION_REPLAY_RLS', 'manglende RLS');
  mutateResult(value => { value.security_tests.project_functions.push({ name: 'public.fixture()' }); }, 'PROMOTION_REPLAY_FUNCTIONS', 'projektfunktion');
  mutateResult(value => { value.security_tests.default_function_privilege_probe.public_execute = true; }, 'PROMOTION_REPLAY_PUBLIC_EXECUTE', 'PUBLIC EXECUTE');
  mutateResult(value => { value.security_tests.negative_writes_denied = 47; }, 'PROMOTION_REPLAY_PRIVILEGES', 'write-adgang');
  mutateResult(value => { value.deals_policy_review.status = 'resolved_without_evidence'; }, 'PROMOTION_REPLAY_DEALS', 'gættet policybeslutning');
  mutateResult(value => { value.inputs.candidate_sha256 = '0'.repeat(64); }, 'PROMOTION_REPLAY_INPUT_HASH', 'ændret candidatehash');

  const artifact = join(fixture, 'private/PG_VERSION');
  try {
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, '17\n');
    assertBlocked('PROMOTION_REPLAY_ARTIFACT', 'lokal databasefil');
  } finally {
    rmSync(join(fixture, 'private'), { recursive: true, force: true });
  }

  assert.equal(run().status, 0, 'Alle mutationer skulle være gendannet');
  console.log('Promotion-replay-værn: 10 mutationer blokeret · alle fixtures gendannet');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
