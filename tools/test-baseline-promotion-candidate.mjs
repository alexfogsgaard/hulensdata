#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPromotionCandidate } from './lib/project-baseline-promotion.mjs';

const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'hulensdata-promotion-candidate-'));
const checker = join(root, 'tools/check-baseline-promotion-candidate.mjs');

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

function mutateText(relativePath, mutate, code, label) {
  const path = join(fixture, relativePath);
  const original = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, mutate(original));
    assertBlocked(code, label);
  } finally {
    writeFileSync(path, original);
  }
}

function mutateInventory(mutate, code, label) {
  const path = join(fixture, 'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json');
  const original = readFileSync(path, 'utf8');
  try {
    const value = JSON.parse(original);
    mutate(value);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    assertBlocked(code, label);
  } finally {
    writeFileSync(path, original);
  }
}

try {
  for (const relativePath of [
    'supabase/baseline/project-schema-baseline.promotion-candidate.sql',
    'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json',
    'supabase/baseline/project-schema-baseline.draft.sql',
    'supabase/baseline/project-schema-baseline.draft.inventory.json',
    'supabase/schema-dump-review.json',
  ]) {
    const target = join(fixture, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, relativePath), target);
  }
  assert.equal(run().status, 0, `Promotion-check skulle være grøn\n${output(run())}`);

  const sql = 'supabase/baseline/project-schema-baseline.promotion-candidate.sql';
  mutateText(sql, value => `${value}\nCREATE FUNCTION public.fixture() RETURNS void LANGUAGE sql SECURITY DEFINER AS 'SELECT';\n`,
    'PROMOTION_DETERMINISM', 'SECURITY DEFINER-funktion');
  mutateText(sql, value => `${value}\nGRANT INSERT ON public.companies TO anon;\n`,
    'PROMOTION_DETERMINISM', 'anon-write-grant');
  mutateText(sql, value => value.replace('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;\n', ''),
    'PROMOTION_DETERMINISM', 'default PUBLIC EXECUTE');
  mutateText(sql, value => value.replace('CREATE POLICY "Public read access" ON public.deals FOR SELECT TO anon', 'CREATE POLICY "Public read access" ON public.deals FOR SELECT TO authenticated'),
    'PROMOTION_DETERMINISM', 'ændret deals-policy');
  mutateText(sql, value => `${value}\nALTER TABLE public.deals OWNER TO postgres;\n`,
    'PROMOTION_DETERMINISM', 'owner-statement');
  mutateText(sql, value => `${value}\nINSERT INTO public.companies (id, name, slug) VALUES (1, 'x', 'x');\n`,
    'PROMOTION_DETERMINISM', 'indlejret data');
  mutateInventory(value => { value.candidate.production_applied = true; }, 'PROMOTION_INVENTORY', 'falsk productionstatus');
  mutateInventory(value => { value.candidate.migration_history_alignment_authorized = true; }, 'PROMOTION_INVENTORY', 'falsk historikautorisation');

  const draft = readFileSync(join(fixture, 'supabase/baseline/project-schema-baseline.draft.sql'), 'utf8');
  const draftInventory = readFileSync(join(fixture, 'supabase/baseline/project-schema-baseline.draft.inventory.json'), 'utf8');
  assert.equal(buildPromotionCandidate(draft, draftInventory), buildPromotionCandidate(draft, draftInventory), 'Generatoroutput skal være deterministisk');

  const artifact = join(fixture, 'private/postgres.log');
  try {
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, 'private fixture\n');
    assertBlocked('PROMOTION_ARTIFACT', 'privat replayartefakt');
  } finally {
    rmSync(join(fixture, 'private'), { recursive: true, force: true });
  }

  assert.equal(run().status, 0, 'Alle mutationer skulle være gendannet');
  console.log('Promotion-candidate-værn: 9 mutationer blokeret · deterministisk generator · alle fixtures gendannet');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
