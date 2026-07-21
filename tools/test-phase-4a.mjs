#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dryRun } from './editorial-dry-run.mjs';
import { buildBackupManifest } from './build-backup-manifest.mjs';
import { generateCoverage, mergeCoverage } from './build-coverage-backlog.mjs';
import { verifyBackupManifest } from './verify-backup-manifest.mjs';
import {
  assertLedgerPrefix,
  validateInbox,
  validateRevisionEntries,
} from './lib/editorial-contracts.mjs';
import {
  readJsonFile,
  resolveContainedArtifact,
  scanSecrets,
} from './lib/editorial-files.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'phase-4');
const clone = value => structuredClone(value);
const inbox = () => readJsonFile(join(FIXTURES, 'inbox', 'valid.json')).value;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function rejectsCode(code, fn) {
  assert.throws(fn, error => {
    assert.equal(error.code, code, `forventede ${code}, fik ${error.code}: ${error.message}`);
    return true;
  });
}

test('gyldig inbox og dry-run er deterministisk og read-only', () => {
  const inboxInput = readJsonFile(join(FIXTURES, 'inbox', 'valid.json'));
  const snapshotInput = readJsonFile(join(FIXTURES, 'snapshot', 'minimal.json'), { secretScan: false });
  const before = readFileSync(join(FIXTURES, 'snapshot', 'minimal.json'));
  const first = dryRun(inboxInput, snapshotInput);
  const second = dryRun(inboxInput, snapshotInput);
  assert.deepEqual(first, second);
  assert.equal(first.mode, 'read_only');
  assert.equal(first.redirects.length, 1);
  assert.deepEqual(readFileSync(join(FIXTURES, 'snapshot', 'minimal.json')), before);
});

test('dubleret operation_id afvises', () => {
  const value = inbox();
  value.operations[1].operation_id = value.operations[0].operation_id;
  rejectsCode('OPERATION_ID_DUPLICATE', () => validateInbox(value));
});

test('set med value:null på update afvises — clear er eneste NULL-repræsentation', () => {
  const value = inbox();
  value.operations[0].changes = [{ field: 'category', action: 'set', expected_before: 'Service', value: null }];
  value.operations[0].redirect_from = null;
  rejectsCode('SET_NULL_USE_CLEAR', () => validateInbox(value));
});

test('clear på insert afvises — NULL er en startværdi, ikke en rydning', () => {
  const value = inbox();
  const insert = value.operations.find(operation => operation.kind === 'insert' && operation.target.entity_type === 'company_event');
  insert.changes.find(change => change.field === 'description').action = 'clear';
  rejectsCode('INSERT_CLEAR', () => validateInbox(value));
});

test('ukendt local_ref afvises', () => {
  const value = inbox();
  value.operations[2].target.secondary_local_ref = 'new:mangler';
  rejectsCode('LOCAL_REF_UNKNOWN', () => validateInbox(value));
});

test('samme targetfelt må ikke ændres to gange', () => {
  const value = inbox();
  const duplicate = clone(value.operations[0]);
  duplicate.operation_id = '00000000-0000-4000-8000-000000000299';
  value.operations.push(duplicate);
  rejectsCode('OPERATION_CONFLICT', () => validateInbox(value));
});

test('forældet expected_before stopper dry-run', () => {
  const inboxInput = readJsonFile(join(FIXTURES, 'inbox', 'valid.json'));
  const snapshotInput = readJsonFile(join(FIXTURES, 'snapshot', 'minimal.json'), { secretScan: false });
  snapshotInput.value.companies[0].slug = 'ændret-udenfor-batch';
  rejectsCode('TARGET_SLUG', () => dryRun(inboxInput, snapshotInput));
  snapshotInput.value.companies[0].slug = 'eksempel';
  inboxInput.value.operations[0].changes[0].expected_before = 'gammel-vaerdi';
  inboxInput.value.operations[0].redirect_from = 'gammel-vaerdi';
  rejectsCode('PRECONDITION_STALE', () => dryRun(inboxInput, snapshotInput));
});

test('slugændring uden redirect afvises', () => {
  const value = inbox();
  value.operations[0].redirect_from = null;
  rejectsCode('SLUG_REDIRECT_REQUIRED', () => validateInbox(value));
});

test('clear kræver eksplicit null', () => {
  const value = inbox();
  value.operations[0].changes[0].action = 'clear';
  rejectsCode('CLEAR_VALUE', () => validateInbox(value));
});

test('DELETE findes ikke i den offentlige kontrakt', () => {
  const value = inbox();
  value.operations[0].kind = 'delete';
  rejectsCode('SCHEMA_INVALID', () => validateInbox(value));
});

test('legitime NULL-tilstande og source uden URL accepteres', () => {
  const value = inbox();
  value.operations[0].sources[0].source_url = null;
  assert.doesNotThrow(() => validateInbox(value));
});

test('coverage og overlay er deterministiske', () => {
  const input = readJsonFile(join(FIXTURES, 'snapshot', 'minimal.json'), { secretScan: false });
  const first = generateCoverage(input);
  const second = generateCoverage(input);
  assert.deepEqual(first, second);
  assert.ok(first.items.some(item => item.dimension === 'cvr' && item.observed_state === 'unknown'));
  const overlay = readJsonFile(join(FIXTURES, 'coverage', 'overlay-valid.json')).value;
  assert.deepEqual(mergeCoverage(first, overlay), mergeCoverage(second, overlay));
});

test('ukendt overlay-item afvises', () => {
  const backlog = generateCoverage(readJsonFile(join(FIXTURES, 'snapshot', 'minimal.json'), { secretScan: false }));
  const overlay = readJsonFile(join(FIXTURES, 'coverage', 'overlay-valid.json')).value;
  overlay.items[0].item_id = 'COMPANY_CVR_UNKNOWN:999999';
  rejectsCode('OVERLAY_ITEM_UNKNOWN', () => mergeCoverage(backlog, overlay));
});

test('ledger er append-only på byte-prefix', () => {
  const previous = readFileSync(join(FIXTURES, 'ledger', 'valid.ndjson'), 'utf8');
  assert.doesNotThrow(() => assertLedgerPrefix(`${previous}{"ny":"linje"}\n`, previous));
  rejectsCode('LEDGER_PREFIX', () => assertLedgerPrefix(previous.replace('validated', 'applied'), previous));
});

test('applied revision kræver approver, after-hash og backup-id', () => {
  const entry = JSON.parse(readFileSync(join(FIXTURES, 'ledger', 'valid.ndjson'), 'utf8').trim());
  entry.result = 'applied';
  rejectsCode('REVISION_APPLIED_FIELDS', () => validateRevisionEntries([entry]));
});

test('komplet syntetisk backupmanifest verificeres', () => {
  const result = verifyBackupManifest(join(FIXTURES, 'backup', 'complete-small', 'manifest.json'));
  assert.equal(result.backup_scope, 'data_export');
  assert.equal(result.artifacts, 10);
});

const temp = mkdtempSync(join(tmpdir(), 'hulensdata-phase4a-'));
try {
  test('manifestmutationer: manglende artifact, hash og rows afvises', () => {
    const source = join(FIXTURES, 'backup', 'complete-small');
    const cases = [
      ['missing', 'MANIFEST_ARTIFACT_MISSING', manifest => { manifest.artifacts = manifest.artifacts.filter(item => item.object_name !== 'sources'); }],
      ['hash', 'MANIFEST_HASH', manifest => { manifest.artifacts.find(item => item.object_name === 'companies').sha256 = '0'.repeat(64); }],
      ['rows', 'MANIFEST_ROWS', manifest => { manifest.artifacts.find(item => item.object_name === 'companies').rows = 1; }],
      ['range', 'MANIFEST_RANGE_TOTAL', manifest => { manifest.artifacts.find(item => item.object_name === 'companies').content_range_total = 1; }],
      ['flags', 'MANIFEST_VERIFICATION_FLAGS', manifest => { manifest.verification.hashes_ok = false; }],
    ];
    for (const [name, code, mutate] of cases) {
      const dir = join(temp, name);
      cpSync(source, dir, { recursive: true });
      const manifestFile = join(dir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      mutate(manifest);
      writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
      rejectsCode(code, () => verifyBackupManifest(manifestFile));
    }
  });

  test('ufuldstændig eksport får failed og kan ikke godkendes', () => {
    const dir = join(temp, 'partial-builder');
    cpSync(join(FIXTURES, 'backup', 'complete-small'), dir, { recursive: true });
    rmSync(join(dir, 'schema-migrations.txt'));
    const manifest = buildBackupManifest(dir, {
      backup_id: '00000000-0000-4000-8000-000000000499',
      created_at: '2026-01-03T08:00:00Z',
      verified_at: '2026-01-03T08:01:00Z',
      project_ref: 'fixture0000000000000',
      database_version: '17-fixture',
      environment: 'isolated',
      read_role: 'anon',
      migration_head: '20260102030405_fixture_only',
      git_sha: '1'.repeat(40),
    });
    assert.equal(manifest.status, 'failed');
    assert.match(manifest.verification.notes, /schema-migrations\.txt/);
    const manifestFile = join(dir, 'manifest-generated.json');
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    rejectsCode('MANIFEST_INCOMPLETE', () => verifyBackupManifest(manifestFile));
  });

  test('backupartifact må ikke være symlink eller path traversal', () => {
    const dir = join(temp, 'symlink');
    cpSync(join(FIXTURES, 'backup', 'complete-small'), dir, { recursive: true });
    symlinkSync('companies.json', join(dir, 'alias.json'));
    rejectsCode('MANIFEST_SYMLINK', () => resolveContainedArtifact(join(dir, 'manifest.json'), 'alias.json'));
    rejectsCode('MANIFEST_PATH', () => resolveContainedArtifact(join(dir, 'manifest.json'), '../udenfor.json'));
  });

  test('credentialmønstre, prototype keys, dybde og filstørrelse afvises', () => {
    rejectsCode('SECRET_APIKEY', () => scanSecrets('apikey = hemmelig'));
    const prototypeFile = join(temp, 'prototype.json');
    writeFileSync(prototypeFile, '{"__proto__":{"polluted":true}}\n');
    rejectsCode('JSON_PROTOTYPE_KEY', () => readJsonFile(prototypeFile));
    const deepFile = join(temp, 'deep.json');
    writeFileSync(deepFile, `${JSON.stringify({ a: { b: { c: 1 } } })}\n`);
    rejectsCode('JSON_DEPTH', () => readJsonFile(deepFile, { maxDepth: 1 }));
    const largeFile = join(temp, 'large.json');
    writeFileSync(largeFile, ' '.repeat(32));
    rejectsCode('FILE_SIZE', () => readJsonFile(largeFile, { maxBytes: 16 }));
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

test('dry-run-kæden har ingen netværks- eller skriveimports', () => {
  const files = [
    'tools/editorial-dry-run.mjs',
    'tools/lib/editorial-files.mjs',
    'tools/lib/editorial-contracts.mjs',
    'tools/lib/json-schema.mjs',
  ];
  const forbidden = [/\bfetch\s*\(/, /https?:\/\//, /SUPABASE/i, /createClient\s*\(/, /writeFile/, /appendFile/, /unlinkSync/, /renameSync/];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} matcher ${pattern}`);
  }
});

test('Trykpressen er uafhængig af levende fase 4A-artefakter', () => {
  const source = readFileSync(join(ROOT, 'tools', 'tryk.mjs'), 'utf8');
  assert.doesNotMatch(source, /editorial-private|editorial-inbox|revision-entry|coverage-overlay|validate-editorial/);
});

test('deploy-gaten validerer kun committede fase 4A-fixtures', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.verify, /test:phase-4a/);
  assert.doesNotMatch(pkg.scripts.verify, /verify:editorial|editorial-private/);
});

console.log(`Fase 4A mutationstests: ${passed} bestået · 0 blockers`);
