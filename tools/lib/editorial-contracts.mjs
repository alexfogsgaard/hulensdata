import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorialError } from './editorial-files.mjs';
import { assertSchema } from './json-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = name => JSON.parse(readFileSync(join(ROOT, 'schemas', name), 'utf8'));

export const SCHEMAS = {
  inbox: schema('editorial-inbox.schema.json'),
  revision: schema('revision-entry.schema.json'),
  coverage: schema('coverage-backlog.schema.json'),
  overlay: schema('coverage-overlay.schema.json'),
  manifest: schema('backup-manifest.schema.json'),
};

const CATEGORIES = new Set([
  'Mad & drikke', 'Tøj & accessories', 'Teknologi & apps', 'Design & bolig',
  'Service', 'Børn & familie', 'Oplevelser & underholdning', 'Sundhed & livsstil',
]);
const EVENT_TYPES = new Set(['renegotiated', 'cancelled', 'follow_on_investment', 'exit', 'bankruptcy', 'closed', 'comeback', 'rebrand', 'funding_round', 'milestone', 'other']);
const TARGETS = {
  company: {
    table: 'companies', key: 'id', fields: {
      name: 'string', slug: 'slug', category: value => value === null || CATEGORIES.has(value),
      status: value => ['aktiv', 'inaktiv', 'ukendt'].includes(value), cvr_nummer: value => value === null || /^\d{8}$/.test(value),
      website: 'nullableString', description: 'nullableString',
    },
  },
  deal: {
    table: 'deals', key: 'id', fields: {
      saeson: 'positiveInteger', afsnit: 'nullablePositiveInteger', soeger: 'nullableAmount', andel_tilbudt: 'nullableShare',
      beloeb_modtaget: 'nullableAmount', andel_solgt: 'nullableShare', company_id: 'positiveInteger',
    },
  },
  investor: {
    table: 'investors', key: 'id', fields: {
      canonical_name: 'string', slug: 'slug', initials: 'string', bio: 'nullableString', short_bio: 'nullableString',
      proff_url: 'nullableHttpUrl', website_url: 'nullableHttpUrl',
    },
  },
  season: { table: 'seasons', key: 'season_number', fields: { year: 'positiveInteger', note: 'nullableString' } },
  company_event: {
    table: 'company_events', key: 'id', fields: {
      company_id: 'positiveInteger', event_date: 'date', date_precision: value => ['day', 'month', 'year'].includes(value),
      event_type: value => EVENT_TYPES.has(value), title: 'string', description: 'nullableString', amount: 'nullableAmount',
    },
  },
  source: {
    table: 'sources', key: 'id', fields: {
      entity_type: value => ['deal', 'company', 'investor', 'company_event', 'season'].includes(value),
      entity_id: value => Number.isInteger(value) && value > 0 || typeof value === 'string' && value.startsWith('new:'),
      field_name: 'nullableString', source_name: 'string', source_url: 'nullableHttpUrl', source_date: value => value === null || validDate(value),
      note: 'nullableString', confidence: value => ['confirmed', 'likely', 'uncertain'].includes(value),
    },
  },
  deal_investor: {
    table: 'deal_investors', key: 'deal_id', secondaryKey: 'investor_id', fields: {
      deal_id: 'positiveInteger', investor_id: 'positiveInteger', amount: 'nullableAmount', equity: 'nullableShare',
    },
  },
  panel_membership: {
    table: 'panel_memberships', key: 'season_number', secondaryKey: 'investor_id', fields: {
      season_number: 'positiveInteger', investor_id: 'positiveInteger', role: value => ['fast', 'gaest'].includes(value),
    },
  },
};

function validDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function validHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

const validators = {
  string: value => typeof value === 'string' && value.trim() !== '',
  nullableString: value => value === null || typeof value === 'string',
  positiveInteger: value => Number.isInteger(value) && value > 0,
  nullablePositiveInteger: value => value === null || Number.isInteger(value) && value > 0,
  nullableAmount: value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0,
  nullableShare: value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100,
  slug: value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
  date: validDate,
  nullableHttpUrl: value => value === null || validHttpUrl(value),
};

function assertFieldValue(entityType, field, value, context) {
  const rule = TARGETS[entityType]?.fields[field];
  if (!rule) throw new EditorialError('FIELD_NOT_ALLOWED', `Feltet ${field} må ikke ændres på ${entityType}`, context);
  const valid = typeof rule === 'function' ? rule(value) : validators[rule]?.(value);
  if (!valid) throw new EditorialError('FIELD_TYPE', `Ugyldig værdi/type for ${entityType}.${field}`, context);
}

const targetKey = target => `${target.entity_type}:${target.record_id ?? target.local_ref}:${target.secondary_id ?? target.secondary_local_ref ?? ''}`;

function assertAcyclic(operations, byId) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new EditorialError('DEPENDENCY_CYCLE', 'Operationsafhængigheder indeholder en cyklus', id);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  operations.forEach(operation => visit(operation.operation_id));
}

export function validateInbox(inbox) {
  assertSchema(inbox, SCHEMAS.inbox, 'editorial inbox');
  if (['accepted', 'rejected', 'blocked'].includes(inbox.status)) {
    if (!inbox.review || inbox.review.decision !== inbox.status) throw new EditorialError('REVIEW_STATUS', 'Inbox-status og reviewbeslutning skal matche');
    if (inbox.status === 'accepted' && !(inbox.review.reviewer.kind === 'human' && inbox.review.reviewer.id === 'alexander')) {
      throw new EditorialError('REVIEW_APPROVER', 'Kun Alexander kan godkende en inbox');
    }
  }

  const byId = new Map();
  const localRefs = new Map();
  const touched = new Set();
  for (const operation of inbox.operations) {
    if (byId.has(operation.operation_id)) throw new EditorialError('OPERATION_ID_DUPLICATE', 'operation_id er genbrugt', operation.operation_id);
    byId.set(operation.operation_id, operation);
    const { target } = operation;
    if (operation.kind === 'insert') {
      if (target.record_id !== null || !target.local_ref) throw new EditorialError('INSERT_TARGET', 'Insert kræver record_id:null og unik local_ref', operation.operation_id);
      if (localRefs.has(target.local_ref)) throw new EditorialError('LOCAL_REF_DUPLICATE', 'local_ref er genbrugt', target.local_ref);
      localRefs.set(target.local_ref, operation);
    } else {
      if (!Number.isInteger(target.record_id) || target.local_ref) throw new EditorialError('EXISTING_TARGET', 'Update/link/unlink kræver eksisterende record_id uden local_ref', operation.operation_id);
    }
    if (['link', 'unlink'].includes(operation.kind) && !['deal_investor', 'panel_membership'].includes(target.entity_type)) {
      throw new EditorialError('RELATION_TARGET', 'Link/unlink må kun ramme relationstabeller', operation.operation_id);
    }
    for (const change of operation.changes) {
      if (change.action === 'clear' && change.value !== null) throw new EditorialError('CLEAR_VALUE', 'clear kræver value:null', `${operation.operation_id}:${change.field}`);
      // NULL-disciplin: på eksisterende rækker er `clear` den eneste repræsentation
      // af "ryd feltet"; på insert er NULL en startværdi, og `clear` giver ikke mening.
      if (operation.kind !== 'insert' && change.action === 'set' && change.value === null) throw new EditorialError('SET_NULL_USE_CLEAR', 'NULL på eksisterende rækker skal udtrykkes med action:clear', `${operation.operation_id}:${change.field}`);
      if (operation.kind === 'insert' && change.action === 'clear') throw new EditorialError('INSERT_CLEAR', 'clear kan ikke bruges på insert — angiv set med value:null', `${operation.operation_id}:${change.field}`);
      if (operation.kind === 'insert' && change.expected_before !== null) throw new EditorialError('INSERT_PRECONDITION', 'Insert-felter kræver expected_before:null', `${operation.operation_id}:${change.field}`);
      assertFieldValue(target.entity_type, change.field, change.value, `${operation.operation_id}:${change.field}`);
      const conflict = `${targetKey(target)}:${change.field}`;
      if (touched.has(conflict)) throw new EditorialError('OPERATION_CONFLICT', 'Samme targetfelt ændres mere end én gang i batchen', conflict);
      touched.add(conflict);
    }
    for (const source of operation.sources) {
      for (const field of source.supports) if (!TARGETS[target.entity_type]?.fields[field]) throw new EditorialError('SOURCE_SUPPORT_FIELD', `Kilden understøtter ukendt felt ${field}`, operation.operation_id);
    }
    const slugChange = operation.changes.find(change => change.field === 'slug');
    if (slugChange && ['company', 'investor'].includes(target.entity_type)) {
      if (!operation.redirect_from || operation.redirect_from !== slugChange.expected_before) {
        throw new EditorialError('SLUG_REDIRECT_REQUIRED', 'Slugændring kræver redirect_from lig den gamle slug', operation.operation_id);
      }
    } else if (operation.redirect_from !== null && operation.redirect_from !== undefined) {
      throw new EditorialError('REDIRECT_WITHOUT_SLUG', 'redirect_from må kun bruges ved slugændring', operation.operation_id);
    }
  }

  for (const operation of inbox.operations) {
    for (const dependency of operation.depends_on) if (!byId.has(dependency)) throw new EditorialError('DEPENDENCY_UNKNOWN', 'depends_on peger på ukendt operation', dependency);
    const refs = [operation.target.secondary_local_ref, ...operation.changes.map(change => typeof change.value === 'string' && change.value.startsWith('new:') ? change.value : null)].filter(Boolean);
    for (const ref of refs) if (!localRefs.has(ref)) throw new EditorialError('LOCAL_REF_UNKNOWN', 'Reference peger på ukendt local_ref', ref);
  }
  assertAcyclic(inbox.operations, byId);

  for (const operation of inbox.operations.filter(item => item.kind === 'insert' && item.target.entity_type === 'company_event')) {
    const linkedSource = inbox.operations.some(candidate => candidate.kind === 'insert' && candidate.target.entity_type === 'source'
      && candidate.changes.some(change => change.field === 'entity_id' && change.value === operation.target.local_ref));
    if (!operation.sources.length && !linkedSource) throw new EditorialError('EVENT_WITHOUT_SOURCE', 'Nyt event kræver mindst én inline eller batch-lokal source', operation.operation_id);
    const values = Object.fromEntries(operation.changes.map(change => [change.field, change.value]));
    if (values.date_precision === 'year' && !String(values.event_date).endsWith('-01-01')) throw new EditorialError('EVENT_PRECISION_DATE', 'Årspræcision kræver 1. januar som sorteringsdato', operation.operation_id);
    if (values.date_precision === 'month' && !String(values.event_date).endsWith('-01')) throw new EditorialError('EVENT_PRECISION_DATE', 'Månedspræcision kræver månedens første dag', operation.operation_id);
  }
  return inbox;
}

export function validateCoverage(backlog) {
  assertSchema(backlog, SCHEMAS.coverage, 'coverage backlog');
  const ids = new Set();
  for (const item of backlog.items) {
    if (ids.has(item.item_id)) throw new EditorialError('COVERAGE_ID_DUPLICATE', 'Dubleret coverage item_id', item.item_id);
    ids.add(item.item_id);
    if (item.item_id !== `${item.rule_id}:${item.entity.id}`) throw new EditorialError('COVERAGE_ID', 'item_id skal være regel-id + stabilt database-id', item.item_id);
  }
  return backlog;
}

export function validateOverlay(overlay) {
  assertSchema(overlay, SCHEMAS.overlay, 'coverage overlay');
  const ids = new Set();
  for (const item of overlay.items) {
    if (ids.has(item.item_id)) throw new EditorialError('OVERLAY_ID_DUPLICATE', 'Dubleret overlay item_id', item.item_id);
    ids.add(item.item_id);
    if (['resolved', 'dismissed'].includes(item.workflow_status) && !item.reason.trim()) throw new EditorialError('OVERLAY_REASON', 'Lukkede overlayposter kræver begrundelse', item.item_id);
  }
  return overlay;
}

export function validateRevisionEntries(entries) {
  const ids = new Set();
  for (const entry of entries) {
    assertSchema(entry, SCHEMAS.revision, 'revision entry');
    if (ids.has(entry.revision_id)) throw new EditorialError('REVISION_ID_DUPLICATE', 'revision_id er genbrugt', entry.revision_id);
    ids.add(entry.revision_id);
    if (entry.result === 'approved' && !(entry.approved_by?.kind === 'human' && entry.approved_by?.id === 'alexander')) {
      throw new EditorialError('REVISION_APPROVER', 'Kun Alexander kan sætte approved', entry.revision_id);
    }
    if (entry.result === 'applied' && (!entry.approved_by || !entry.after_sha256 || !entry.backup_id)) {
      throw new EditorialError('REVISION_APPLIED_FIELDS', 'applied kræver approver, after_sha256 og backup_id', entry.revision_id);
    }
    if (entry.supersedes && !ids.has(entry.supersedes)) throw new EditorialError('REVISION_SUPERSEDES', 'supersedes skal pege på en tidligere revision', entry.revision_id);
  }
  return entries;
}

export function assertLedgerPrefix(currentText, previousText) {
  if (!currentText.startsWith(previousText)) {
    throw new EditorialError('LEDGER_PREFIX', 'Ny ledger omskriver eksisterende bytes');
  }
}

export function validateManifestShape(manifest) {
  assertSchema(manifest, SCHEMAS.manifest, 'backup manifest');
  return manifest;
}

export function targetDefinition(entityType) {
  return TARGETS[entityType];
}
