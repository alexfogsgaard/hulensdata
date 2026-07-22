#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BASELINE_PHASES,
  allZero,
  buildProjectBaselineDraft,
  scanBaseline,
  selectProjectSections,
} from './lib/project-baseline-draft.mjs';

const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'hulensdata-project-baseline-'));
const checker = join(root, 'tools/check-project-baseline-draft.mjs');

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

function mutateJson(mutation, code, label) {
  const path = join(fixture, 'supabase/baseline/project-schema-baseline.draft.inventory.json');
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

function scanMutation(sql, group, key, label) {
  const scan = scanBaseline(sql);
  assert.ok(scan[group][key] > 0, `${label} skulle opdages som ${group}.${key}`);
}

function syntheticDump() {
  const sections = BASELINE_PHASES.flatMap(phase => phase.objects);
  return `${sections.map(([type, name], index) => `--
-- TOC entry ${index + 1} (class 0 OID ${index + 1})
-- Name: ${name}; Type: ${type}; Schema: public; Owner: -
--

SELECT ${index + 1};`).join('\n\n')}\n\n-- PostgreSQL database dump complete\n`;
}

try {
  cpSync(join(root, 'supabase'), join(fixture, 'supabase'), { recursive: true });
  const baseline = run();
  assert.equal(baseline.status, 0, `Baseline skulle være grøn\n${output(baseline)}`);

  const sqlPath = 'supabase/baseline/project-schema-baseline.draft.sql';
  mutateText(sqlPath, sql => `${sql}\nINSERT INTO public.companies (name) VALUES ('fixture');\n`,
    'BASELINE_DATA', 'top-level INSERT');
  mutateText(sqlPath, sql => `${sql}\n-- postgres://fixture:do-not-use@example.invalid/postgres\n`,
    'BASELINE_CREDENTIAL', 'credential-URI');
  mutateText(sqlPath, sql => `${sql}\nGRANT INSERT ON public.companies TO anon;\n`,
    'BASELINE_PRIVILEGE', 'GRANT-statement');
  mutateText(sqlPath, sql => `${sql}\nSELECT * FROM auth.users;\n`,
    'BASELINE_PLATFORM', 'Supabase-internt schema');
  mutateText(sqlPath, sql => `${sql}\nCREATE EXTENSION plpgsql;\n`,
    'BASELINE_PLATFORM', 'extension-DDL');
  mutateText(sqlPath, sql => `${sql}\nCREATE EVENT TRIGGER fixture ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();\n`,
    'BASELINE_PLATFORM', 'event-trigger-DDL');
  mutateText(sqlPath, sql => `${sql}\n-- postgres://example.invalid/postgres\n`,
    'BASELINE_PLATFORM', 'connectionreference uden credential');
  mutateText(sqlPath, sql => sql.replace('CREATE TABLE public.companies', 'CREATE TABLE public.companies_missing'),
    'BASELINE_OBJECT_DIFF', 'objektdrift');
  mutateText(sqlPath, sql => sql
    .replace('-- phase: 01_function', '-- phase: temporary')
    .replace('-- phase: 02_tables_and_sequences', '-- phase: 01_function')
    .replace('-- phase: temporary', '-- phase: 02_tables_and_sequences'),
  'BASELINE_PHASE_ORDER', 'ombyttet dependencyorden');

  mutateJson(value => { value.draft.sha256 = '0'.repeat(64); },
    'BASELINE_DRAFT_HASH', 'ændret baselinefingerprint');
  mutateJson(value => { value.draft.replay_authorized = true; },
    'BASELINE_DRAFT_GATE', 'falsk replayautorisation');
  mutateJson(value => { value.provenance.source_review_sha256 = '0'.repeat(64); },
    'BASELINE_SOURCE_REVIEW_HASH', 'ændret source-review-fingerprint');
  mutateJson(value => { value.provenance.method = 'postgres://fixture:do-not-use@example.invalid/postgres'; },
    'BASELINE_INVENTORY_SECRET', 'credential i inventory');

  scanMutation('COPY public.x FROM stdin;', 'data', 'copy_from_stdin', 'COPY-data');
  scanMutation('SELECT pg_catalog.setval(\'public.x_seq\', 1, true);', 'data', 'sequence_values', 'sekvensværdi');
  scanMutation('CREATE ROLE fixture;', 'privileges', 'create_role', 'custom role');
  scanMutation('SELECT * FROM supabase_migrations.schema_migrations;', 'platform', 'migration_history_references', 'migrationshistorik');
  scanMutation('CREATE PUBLICATION fixture;', 'platform', 'publication_ddl', 'publication');
  assert.equal(allZero(scanBaseline('SELECT 1;').data), true, 'Ren SQL-fixture må ikke ligne tabeldata');

  const dump = syntheticDump();
  const review = JSON.stringify({ private_artifacts: { dump: { sha256: 'a'.repeat(64) } } });
  const first = buildProjectBaselineDraft(dump, review);
  const second = buildProjectBaselineDraft(dump, review);
  assert.equal(first, second, 'Generatoren skal være deterministisk');
  assert.equal(selectProjectSections(dump).size, BASELINE_PHASES.flatMap(phase => phase.objects).length);
  assert.throws(() => selectProjectSections(dump.replace('-- Name: rls_auto_enable(); Type: FUNCTION;', '-- Name: omitted(); Type: FUNCTION;')), /Manglende projektsektion/);
  assert.throws(() => selectProjectSections(`${dump.replace('\n\n-- PostgreSQL database dump complete\n', '')}\n\n--\n-- TOC entry 999 (class 0 OID 999)\n-- Name: surprise; Type: TABLE; Schema: public; Owner: -\n--\n\nCREATE TABLE public.surprise ();\n\n-- PostgreSQL database dump complete\n`), /Uklassificerede public-sektioner/);

  assert.equal(run().status, 0, 'Alle mutationer skulle være gendannet');
  console.log('Project-baseline-værn: 13 checker-mutationer blokeret · 5 scannersignaler bevist · deterministisk generator · alle fixtures gendannet');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
