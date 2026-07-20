#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateOperationalPath, EditorialError, readJsonFile } from './lib/editorial-files.mjs';
import { validateCoverage, validateOverlay } from './lib/editorial-contracts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.0.0';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const item = (rule_id, dimension, entity, priority, reason, evidence_refs = []) => ({
  item_id: `${rule_id}:${entity.id}`,
  rule_id,
  dimension,
  entity: { type: entity.type, id: entity.id, slug: entity.slug ?? null },
  observed_state: 'unknown',
  priority,
  reason,
  evidence_refs: [...evidence_refs].sort(),
});

export function generateCoverage(snapshotInput) {
  const snapshot = snapshotInput.value;
  const required = ['deals', 'companies', 'company_events', 'sources'];
  for (const key of required) if (!Array.isArray(snapshot[key])) throw new EditorialError('SNAPSHOT_TABLE', `Snapshot mangler arrayet ${key}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.trykt || '')) throw new EditorialError('SNAPSHOT_DATE', 'Snapshot mangler gyldig trykt-dato');
  const companiesById = new Map(snapshot.companies.map(company => [company.id, company]));
  const companyIdBySlug = new Map(snapshot.companies.map(company => [company.slug, company.id]));
  const companyDeals = new Map(snapshot.companies.map(company => [company.id, []]));
  for (const deal of snapshot.deals) {
    const id = companyIdBySlug.get(deal.company?.slug) ?? deal.company_id;
    if (id != null) (companyDeals.get(id) || []).push(deal);
  }
  const eventCompanyIds = new Set(snapshot.company_events.map(event => companyIdBySlug.get(event.company?.slug) ?? event.company_id).filter(Boolean));
  const sourcedCompanyIds = new Set();
  const dealCompany = new Map(snapshot.deals.map(deal => [deal.id, companyIdBySlug.get(deal.company?.slug) ?? deal.company_id]));
  const eventCompany = new Map(snapshot.company_events.map(event => [event.id, companyIdBySlug.get(event.company?.slug) ?? event.company_id]));
  for (const source of snapshot.sources) {
    const id = source.entity_type === 'company' ? source.entity_id
      : source.entity_type === 'deal' ? dealCompany.get(source.entity_id)
        : source.entity_type === 'company_event' ? eventCompany.get(source.entity_id) : null;
    if (id) sourcedCompanyIds.add(id);
  }

  const items = [];
  for (const company of snapshot.companies) {
    const entity = { type: 'company', id: company.id, slug: company.slug };
    const deals = companyDeals.get(company.id) || [];
    if (!company.cvr_nummer) items.push(item('COMPANY_CVR_UNKNOWN', 'cvr', entity, deals.some(deal => deal.aftale) ? 'high' : 'medium', 'CVR er ikke dokumenteret; fraværet er en researchopgave, ikke et negativt fund.'));
    if (!company.category) items.push(item('COMPANY_CATEGORY_UNKNOWN', 'category', entity, 'medium', 'Kategori mangler dokumentation inden for den kanoniske taksonomi.'));
    if (company.status === 'ukendt') items.push(item('COMPANY_STATUS_UNKNOWN', 'company_status', entity, 'medium', 'Virksomhedsstatus er ukendt og må ikke gættes.'));
    if (!sourcedCompanyIds.has(company.id)) items.push(item('COMPANY_SOURCE_UNKNOWN', 'source', entity, 'low', 'Ingen kilde er knyttet til virksomhed, pitch eller efterliv i snapshottet.'));
    if (!eventCompanyIds.has(company.id)) items.push(item('COMPANY_AFTERLIFE_UNKNOWN', 'afterlife', entity, 'low', 'Intet efterliv er dokumenteret; det betyder ikke, at intet er sket.'));
  }
  for (const deal of snapshot.deals) {
    const entity = { type: 'deal', id: deal.id, slug: deal.company?.slug ?? null };
    if (deal.afsnit == null) items.push(item('DEAL_EPISODE_UNKNOWN', 'episode', entity, 'medium', 'Afsnit er ukendt og bevares som NULL.'));
    if (deal.soeger == null) items.push(item('DEAL_ASKED_UNKNOWN', 'asked_amount', entity, 'medium', 'Søgt beløb er ukendt og estimeres ikke.'));
    if (deal.aftale && deal.andel_solgt == null) items.push(item('DEAL_EQUITY_UNKNOWN', 'deal_equity', entity, 'medium', 'Solgt ejerandel for TV-aftalen er ukendt.'));
  }
  items.sort((a, b) => a.item_id.localeCompare(b.item_id, 'en'));
  return validateCoverage({
    schema_version: '1.0.0',
    generated_at: `${snapshot.trykt}T00:00:00Z`,
    generator_version: VERSION,
    snapshot_sha256: snapshotInput.hash,
    items,
  });
}

export function mergeCoverage(backlog, overlay) {
  validateCoverage(backlog);
  validateOverlay(overlay);
  const available = new Set(backlog.items.map(entry => entry.item_id));
  for (const decision of overlay.items) if (!available.has(decision.item_id)) throw new EditorialError('OVERLAY_ITEM_UNKNOWN', 'Overlay peger på et item, der ikke findes i den aktuelle backlog', decision.item_id);
  const decisions = new Map(overlay.items.map(entry => [entry.item_id, entry]));
  return {
    ...backlog,
    items: backlog.items.map(entry => ({ ...entry, workflow: decisions.get(entry.item_id) || null })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const snapshotFile = option('--snapshot');
    if (!snapshotFile) throw new EditorialError('CLI_USAGE', 'Brug --snapshot <sti> [--overlay <privat sti>]');
    const backlog = generateCoverage(readJsonFile(snapshotFile, { secretScan: false, maxItems: 100000 }));
    const overlayFile = option('--overlay');
    const result = overlayFile
      ? (assertPrivateOperationalPath(overlayFile, ROOT), mergeCoverage(backlog, readJsonFile(overlayFile).value))
      : backlog;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(`[BLOCKER] ${error.code || 'COVERAGE_ERROR'}: ${error.message}${error.context ? ` (${error.context})` : ''}`);
    process.exitCode = 1;
  }
}
