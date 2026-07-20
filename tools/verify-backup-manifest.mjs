#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateOperationalPath, EditorialError, readJsonFile, resolveContainedArtifact, sha256 } from './lib/editorial-files.mjs';
import { validateManifestShape } from './lib/editorial-contracts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TABLES = ['seasons', 'investors', 'panel_memberships', 'companies', 'deals', 'deal_investors', 'company_events', 'sources'];
const RESTORE_ORDER = [...TABLES];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function artifactKey(artifact) {
  return `${artifact.kind}:${artifact.object_name || artifact.relative_path}`;
}

export function assertBackupReferences(data) {
  const ids = name => new Set((data[name] || []).map(row => row.id));
  const companyIds = ids('companies');
  const dealIds = ids('deals');
  const investorIds = ids('investors');
  const eventIds = ids('company_events');
  const seasons = new Set((data.seasons || []).map(row => row.season_number));
  for (const deal of data.deals || []) if (!companyIds.has(deal.company_id)) throw new EditorialError('BACKUP_REFERENCE', 'Deal peger på ukendt company', `deals:${deal.id}`);
  for (const relation of data.deal_investors || []) {
    if (!dealIds.has(relation.deal_id) || !investorIds.has(relation.investor_id)) throw new EditorialError('BACKUP_REFERENCE', 'Deal-investorrelation er forældreløs', `${relation.deal_id}:${relation.investor_id}`);
  }
  for (const membership of data.panel_memberships || []) {
    if (!seasons.has(membership.season_number) || !investorIds.has(membership.investor_id)) throw new EditorialError('BACKUP_REFERENCE', 'Panelrelation er forældreløs', `${membership.season_number}:${membership.investor_id}`);
  }
  for (const event of data.company_events || []) if (!companyIds.has(event.company_id)) throw new EditorialError('BACKUP_REFERENCE', 'Event peger på ukendt company', `company_events:${event.id}`);
  const targets = { deal: dealIds, company: companyIds, investor: investorIds, company_event: eventIds, season: seasons };
  for (const source of data.sources || []) if (!targets[source.entity_type]?.has(source.entity_id)) throw new EditorialError('BACKUP_REFERENCE', 'Source peger på ukendt target', `sources:${source.id}`);
}

export function verifyBackupManifest(manifestFile) {
  const manifestInput = readJsonFile(manifestFile);
  const manifest = validateManifestShape(manifestInput.value);
  if (manifest.status !== 'complete') throw new EditorialError('MANIFEST_INCOMPLETE', 'Kun status complete kan godkendes som afsluttet eksport');
  if (JSON.stringify(manifest.restore_order) !== JSON.stringify(RESTORE_ORDER)) throw new EditorialError('MANIFEST_RESTORE_ORDER', 'restore_order matcher ikke den kanoniske FK-rækkefølge');

  const keys = new Set();
  const paths = new Set();
  const data = {};
  for (const artifact of manifest.artifacts) {
    const key = artifactKey(artifact);
    if (keys.has(key)) throw new EditorialError('MANIFEST_ARTIFACT_DUPLICATE', 'Dubleret artifact', key);
    if (paths.has(artifact.relative_path)) throw new EditorialError('MANIFEST_PATH_DUPLICATE', 'Dubleret artifact-sti', artifact.relative_path);
    keys.add(key);
    paths.add(artifact.relative_path);
    const file = resolveContainedArtifact(manifestFile, artifact.relative_path);
    const bytes = readFileSync(file);
    if (bytes.length !== artifact.bytes) throw new EditorialError('MANIFEST_BYTES', 'Byteantal matcher ikke manifest', artifact.relative_path);
    if (sha256(bytes) !== artifact.sha256) throw new EditorialError('MANIFEST_HASH', 'SHA-256 matcher ikke manifest', artifact.relative_path);
    if (['table_json', 'view_json', 'publication_snapshot'].includes(artifact.kind)) {
      let rows;
      try { rows = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new EditorialError('MANIFEST_JSON', `Artifact er ikke gyldig JSON: ${error.message}`, artifact.relative_path); }
      if (artifact.kind !== 'publication_snapshot' && !Array.isArray(rows)) throw new EditorialError('MANIFEST_JSON_TYPE', 'Tabel/view-artifact skal være et JSON-array', artifact.relative_path);
      if (Array.isArray(rows)) {
        if (artifact.rows !== rows.length) throw new EditorialError('MANIFEST_ROWS', 'Rækketal matcher ikke artifact', artifact.relative_path);
        if (artifact.content_range_total != null && artifact.content_range_total !== rows.length) throw new EditorialError('MANIFEST_RANGE_TOTAL', 'Content-Range-total matcher ikke rækketal', artifact.relative_path);
        if (artifact.kind === 'table_json') data[artifact.object_name] = rows;
      }
    }
  }

  for (const table of TABLES) if (!keys.has(`table_json:${table}`)) throw new EditorialError('MANIFEST_ARTIFACT_MISSING', `Manifest mangler tabellen ${table}`);
  if (!keys.has('view_json:investor_status')) throw new EditorialError('MANIFEST_ARTIFACT_MISSING', 'Manifest mangler investor_status-viewet');
  if (![...keys].some(key => key.startsWith('migration_list:'))) throw new EditorialError('MANIFEST_ARTIFACT_MISSING', 'Manifest mangler migrationslisten');
  if (manifest.backup_scope === 'full_recovery_set') {
    for (const kind of ['schema_ddl', 'policy_dump', 'grant_dump']) if (![...keys].some(key => key.startsWith(`${kind}:`))) throw new EditorialError('MANIFEST_RECOVERY_ARTIFACT', `Fuldt recovery-set mangler ${kind}`);
  }
  assertBackupReferences(data);
  if (!manifest.verification.hashes_ok || !manifest.verification.json_parse_ok || !manifest.verification.row_counts_ok || !manifest.verification.references_ok) {
    throw new EditorialError('MANIFEST_VERIFICATION_FLAGS', 'Manifestets verifikationsflag modsiger en complete eksport');
  }
  return {
    backup_id: manifest.backup_id,
    backup_scope: manifest.backup_scope,
    artifacts: manifest.artifacts.length,
    consistency: manifest.consistency,
    restore_rehearsed: manifest.verification.restore_rehearsed,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const file = option('--manifest');
    if (!file) throw new EditorialError('CLI_USAGE', 'Brug --manifest <sti>');
    assertPrivateOperationalPath(file, ROOT);
    const result = verifyBackupManifest(file);
    console.log(`Backupmanifest: ${result.backup_scope} · ${result.artifacts} artifacts · ${result.consistency} · restore rehearsal ${result.restore_rehearsed ? 'ja' : 'nej'} · 0 blockers`);
  } catch (error) {
    console.error(`[BLOCKER] ${error.code || 'BACKUP_ERROR'}: ${error.message}${error.context ? ` (${error.context})` : ''}`);
    process.exitCode = 1;
  }
}
