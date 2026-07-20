#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateOperationalPath, EditorialError, readJsonFile } from './lib/editorial-files.mjs';
import { targetDefinition, validateInbox } from './lib/editorial-contracts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function findTarget(snapshot, target) {
  const definition = targetDefinition(target.entity_type);
  const rows = snapshot[definition.table];
  if (!Array.isArray(rows)) throw new EditorialError('SNAPSHOT_TABLE', `Snapshot mangler ${definition.table}`);
  return rows.find(row => row[definition.key] === target.record_id
    && (!definition.secondaryKey || row[definition.secondaryKey] === target.secondary_id));
}

export function dryRun(inboxInput, snapshotInput) {
  const inbox = validateInbox(inboxInput.value);
  const snapshot = snapshotInput.value;
  if (inbox.baseline.snapshot_sha256 !== snapshotInput.hash) throw new EditorialError('BASELINE_HASH', 'Inboxens snapshot-hash matcher ikke baselinefilen');
  if (inbox.baseline.snapshot_date !== snapshot.trykt) throw new EditorialError('BASELINE_DATE', 'Inboxens snapshotdato matcher ikke baselinefilen');
  const requiredArrays = ['deals', 'deal_investors', 'investors', 'investor_status', 'seasons', 'panel_memberships', 'companies', 'company_events', 'sources'];
  for (const key of requiredArrays) if (!Array.isArray(snapshot[key])) throw new EditorialError('SNAPSHOT_TABLE', `Snapshot mangler arrayet ${key}`);

  const operations = inbox.operations.map(operation => {
    if (operation.kind === 'insert') {
      return {
        operation_id: operation.operation_id,
        action: 'would_insert',
        target: operation.target.local_ref,
        entity_type: operation.target.entity_type,
        changes: operation.changes.map(change => ({ field: change.field, before: null, after: change.value })),
      };
    }
    const row = findTarget(snapshot, operation.target);
    if (!row) throw new EditorialError('TARGET_NOT_FOUND', 'Target findes ikke i baseline', `${operation.target.entity_type}:${operation.target.record_id}`);
    if (operation.target.slug != null && row.slug !== operation.target.slug) throw new EditorialError('TARGET_SLUG', 'Target-slug matcher ikke baseline', operation.operation_id);
    const changes = operation.changes.map(change => {
      if (!Object.prototype.hasOwnProperty.call(row, change.field)) throw new EditorialError('PRECONDITION_FIELD', 'Precondition-felt findes ikke i snapshotrække', `${operation.operation_id}:${change.field}`);
      if (!isDeepStrictEqual(row[change.field], change.expected_before)) throw new EditorialError('PRECONDITION_STALE', 'expected_before matcher ikke baseline', `${operation.operation_id}:${change.field}`);
      return { field: change.field, before: row[change.field], after: change.value };
    });
    return { operation_id: operation.operation_id, action: `would_${operation.kind}`, target: `${operation.target.entity_type}:${operation.target.record_id}`, entity_type: operation.target.entity_type, changes };
  });

  const redirects = inbox.operations.flatMap(operation => {
    const slugChange = operation.changes.find(change => change.field === 'slug');
    if (!slugChange) return [];
    const prefix = operation.target.entity_type === 'company' ? 'virksomheder' : 'loever';
    return [`/${prefix}/${operation.redirect_from}/  /${prefix}/${slugChange.value}/  301`];
  });
  return { mode: 'read_only', inbox_id: inbox.inbox_id, baseline_sha256: snapshotInput.hash, operations, redirects };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const inboxFile = option('--inbox');
    const snapshotFile = option('--snapshot');
    if (!inboxFile || !snapshotFile) throw new EditorialError('CLI_USAGE', 'Brug --inbox <fil> --snapshot <fil>');
    assertPrivateOperationalPath(inboxFile, ROOT);
    const result = dryRun(readJsonFile(inboxFile), readJsonFile(snapshotFile, { secretScan: false, maxItems: 100000 }));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error.code || 'EDITORIAL_ERROR';
    process.stderr.write(`[BLOCKER] ${code}: ${error.message}${error.context ? ` (${error.context})` : ''}\n`);
    process.exitCode = 1;
  }
}
