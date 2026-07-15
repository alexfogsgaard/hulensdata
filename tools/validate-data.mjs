#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReport } from './lib/report.mjs';

const file = resolve(process.argv[2] || 'data/arkiv.json');
const report = createReport('Datavalidering');

let archive;
try {
  archive = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  report.blocker('DATA_FILE', `Kunne ikke læse gyldig JSON: ${error.message}`, file);
  report.finish();
  process.exit();
}

const requiredArrays = [
  'deals', 'deal_investors', 'investors', 'investor_status', 'seasons',
  'panel_memberships', 'companies', 'company_events', 'sources',
];

for (const key of requiredArrays) {
  if (!Array.isArray(archive[key])) {
    const message = key === 'deal_investors'
      ? 'Snapshot mangler rå deal_investors; orphan-relationer kan ikke valideres'
      : `Snapshot mangler arrayet ${key}`;
    report.blocker('DATA_TABLE', message, key);
  }
}

const deals = archive.deals || [];
const rawDealInvestors = archive.deal_investors || [];
const investors = archive.investors || [];
const statuses = archive.investor_status || [];
const seasons = archive.seasons || [];
const memberships = archive.panel_memberships || [];
const companies = archive.companies || [];
const events = archive.company_events || [];
const sources = archive.sources || [];

const ids = rows => new Set(rows.map(row => row.id));
const dealIds = ids(deals);
const investorIds = ids(investors);
const companyIds = ids(companies);
const eventIds = ids(events);
const seasonIds = new Set(seasons.map(row => row.season_number));
const investorNames = new Set(investors.map(row => row.canonical_name));
const companyBySlug = new Map(companies.map(row => [row.slug, row]));
const investorById = new Map(investors.map(row => [row.id, row]));
const investorByName = new Map(investors.map(row => [row.canonical_name, row]));

function required(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function duplicates(rows, valueFor) {
  const seen = new Map();
  for (const row of rows) {
    const value = valueFor(row);
    if (!required(value)) continue;
    const key = String(value).toLocaleLowerCase('da-DK');
    const list = seen.get(key) || [];
    list.push(row);
    seen.set(key, list);
  }
  return [...seen.entries()].filter(([, rowsForValue]) => rowsForValue.length > 1);
}

const primaryKeys = [
  ['DEAL_ID_DUPLICATE', 'deal-id', deals, row => row.id],
  ['INVESTOR_ID_DUPLICATE', 'investor-id', investors, row => row.id],
  ['INVESTOR_STATUS_DUPLICATE', 'investorstatus', statuses, row => row.canonical_name],
  ['SEASON_ID_DUPLICATE', 'sæsonnummer', seasons, row => row.season_number],
  ['COMPANY_ID_DUPLICATE', 'virksomheds-id', companies, row => row.id],
  ['EVENT_ID_DUPLICATE', 'event-id', events, row => row.id],
  ['SOURCE_ID_DUPLICATE', 'kilde-id', sources, row => row.id],
];
for (const [code, label, rows, keyFor] of primaryKeys) {
  for (const [value, duplicateRows] of duplicates(rows, keyFor)) {
    report.blocker(code, `Dubleret ${label}: ${value}`, duplicateRows.map(row => row.id ?? row.canonical_name ?? row.season_number).join(', '));
  }
}

for (const [value, rows] of duplicates(companies, row => row.slug)) {
  report.blocker('COMPANY_SLUG_DUPLICATE', `Dubleret virksomhedsslug: ${value}`, rows.map(row => `${row.id}:${row.name}`).join(', '));
}
for (const [value, rows] of duplicates(companies, row => row.name)) {
  report.blocker('COMPANY_NAME_DUPLICATE', `Dubleret virksomhedsnavn: ${value}`, rows.map(row => row.id).join(', '));
}
for (const [value, rows] of duplicates(companies, row => row.cvr_nummer)) {
  report.blocker('COMPANY_CVR_DUPLICATE', `Dubleret CVR uden dokumenteret undtagelse: ${value}`, rows.map(row => `${row.id}:${row.name}`).join(', '));
}
for (const [value, rows] of duplicates(investors, row => row.slug)) {
  report.blocker('INVESTOR_SLUG_DUPLICATE', `Dubleret investorslug: ${value}`, rows.map(row => row.id).join(', '));
}
for (const [value, rows] of duplicates(investors, row => row.canonical_name)) {
  report.blocker('INVESTOR_NAME_DUPLICATE', `Dubleret investornavn: ${value}`, rows.map(row => row.id).join(', '));
}

const allowedCompanyStatuses = new Set(['aktiv', 'inaktiv', 'ukendt']);
const allowedCategories = new Set([
  'Mad & drikke', 'Tøj & accessories', 'Teknologi & apps', 'Design & bolig',
  'Service', 'Børn & familie', 'Oplevelser & underholdning', 'Sundhed & livsstil',
]);
const validSlug = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ''));
for (const company of companies) {
  const context = `companies:${company.id ?? '?'} ${company.name ?? ''}`.trim();
  if (!required(company.id) || !required(company.name) || !required(company.slug)) report.blocker('COMPANY_IDENTITY', 'Virksomhed mangler id, navn eller slug', context);
  if (required(company.slug) && !validSlug(company.slug)) report.blocker('COMPANY_SLUG', `Ugyldigt URL-slug: ${company.slug}`, context);
  if (!allowedCompanyStatuses.has(company.status)) report.blocker('COMPANY_STATUS', `Ugyldig status: ${company.status}`, context);
  if (company.category != null && !allowedCategories.has(company.category)) report.blocker('COMPANY_CATEGORY', `Ugyldig kategori: ${company.category}`, context);
  if (company.cvr_nummer != null && !/^\d{8}$/.test(String(company.cvr_nummer))) report.blocker('COMPANY_CVR', `CVR skal være præcis otte cifre: ${company.cvr_nummer}`, context);
}

for (const investor of investors) {
  const context = `investors:${investor.id ?? '?'} ${investor.canonical_name ?? ''}`.trim();
  if (!required(investor.id) || !required(investor.canonical_name) || !required(investor.slug)) {
    report.blocker('INVESTOR_IDENTITY', 'Investor mangler id, kanonisk navn eller slug', context);
  }
  if (required(investor.slug) && !validSlug(investor.slug)) report.blocker('INVESTOR_SLUG', `Ugyldigt URL-slug: ${investor.slug}`, context);
}

for (const season of seasons) {
  const context = `seasons:${season.season_number ?? '?'}`;
  if (!Number.isInteger(season.season_number) || season.season_number < 1) report.blocker('SEASON_NUMBER', `Ugyldigt sæsonnummer: ${season.season_number}`, context);
  if (!Number.isInteger(season.year) || season.year < 1900 || season.year > 2100) report.blocker('SEASON_YEAR', `Ugyldigt sæsonår: ${season.year}`, context);
}

const relationPairs = new Set();
const rawInvestorsByDeal = new Map();
for (const relation of rawDealInvestors) {
  const context = `deal_investors:${relation.deal_id}:${relation.investor_id}`;
  if (!dealIds.has(relation.deal_id)) report.blocker('DEAL_INVESTOR_DEAL', 'Relation peger på ukendt deal', context);
  if (!investorIds.has(relation.investor_id)) report.blocker('DEAL_INVESTOR_INVESTOR', 'Relation peger på ukendt investor', context);
  const key = `${relation.deal_id}:${relation.investor_id}`;
  if (relationPairs.has(key)) report.blocker('DEAL_INVESTOR_DUPLICATE', 'Dubleret deal/investor-relation', context);
  relationPairs.add(key);
  const investor = investorById.get(relation.investor_id);
  if (dealIds.has(relation.deal_id) && investor) {
    const names = rawInvestorsByDeal.get(relation.deal_id) || [];
    names.push(investor.canonical_name);
    rawInvestorsByDeal.set(relation.deal_id, names);
  }
}

for (const deal of deals) {
  const context = `deals:${deal.id ?? '?'} ${deal.company?.name ?? ''}`.trim();
  if (!required(deal.id)) report.blocker('DEAL_ID', 'Deal mangler id', context);
  const canonicalCompany = deal.company && companyBySlug.get(deal.company.slug);
  if (!canonicalCompany) report.blocker('DEAL_COMPANY', 'Deal mangler gyldig virksomhed', context);
  else if (deal.company.name !== canonicalCompany.name || deal.company.category !== canonicalCompany.category || deal.company.status !== canonicalCompany.status) {
    report.blocker('DEAL_COMPANY_SYNC', 'Dealens indlejrede virksomhed modsiger companies-tabellen', context);
  }
  if (!seasonIds.has(deal.saeson)) report.blocker('DEAL_SEASON', `Ugyldigt sæsonnummer: ${deal.saeson}`, context);
  if (deal.afsnit != null && (!Number.isInteger(deal.afsnit) || deal.afsnit < 1)) report.blocker('DEAL_EPISODE', `Ugyldigt afsnit: ${deal.afsnit}`, context);
  for (const [field, value] of [['soeger', deal.soeger], ['beloeb_modtaget', deal.beloeb_modtaget]]) {
    if (value != null && (!Number.isFinite(value) || value < 0)) report.blocker('DEAL_AMOUNT', `Ugyldigt beløb i ${field}: ${value}`, context);
  }
  for (const [field, value] of [['andel_tilbudt', deal.andel_tilbudt], ['andel_solgt', deal.andel_solgt]]) {
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) report.blocker('DEAL_SHARE', `Ejerandel uden for 0–100 i ${field}: ${value}`, context);
  }
  const embeddedInvestors = (deal.deal_investors || []).map(row => row.investor?.canonical_name).filter(required);
  if (embeddedInvestors.some(name => !investorNames.has(name))) report.blocker('DEAL_INVESTOR_EMBED', 'Deal indeholder ukendt investor', `${context}: ${embeddedInvestors.join(', ')}`);
  const rawInvestors = rawInvestorsByDeal.get(deal.id) || [];
  if (embeddedInvestors.slice().sort().join('\u0000') !== rawInvestors.slice().sort().join('\u0000')) {
    report.blocker('DEAL_INVESTOR_SYNC', 'Indlejrede investorer modsiger deal_investors-tabellen', context);
  }
  if (typeof deal.aftale !== 'boolean') report.blocker('DEAL_OUTCOME_TYPE', '`aftale` skal være true eller false', context);
  const hasAmount = deal.beloeb_modtaget != null;
  if (deal.aftale === false && hasAmount) report.blocker('DEAL_OUTCOME', 'Pitch uden TV-aftale har et modtaget beløb', context);
  if (deal.aftale && embeddedInvestors.length === 0) report.blocker('DEAL_WITHOUT_INVESTOR', 'Lukket TV-aftale har ingen investorer', context);
  if (!deal.aftale && embeddedInvestors.length > 0) report.blocker('NO_DEAL_WITH_INVESTOR', 'Pitch uden aftale har investorer', context);
}

const membershipPairs = new Set();
for (const membership of memberships) {
  const context = `panel_memberships:${membership.season_number}:${membership.investor_id}`;
  if (!seasonIds.has(membership.season_number)) report.blocker('PANEL_SEASON', 'Panelrelation peger på ukendt sæson', context);
  if (!investorIds.has(membership.investor_id)) report.blocker('PANEL_INVESTOR', 'Panelrelation peger på ukendt investor', context);
  if (!['fast', 'gaest'].includes(membership.role)) report.blocker('PANEL_ROLE', `Ugyldig panelrolle: ${membership.role}`, context);
  const key = `${membership.season_number}:${membership.investor_id}`;
  if (membershipPairs.has(key)) report.blocker('PANEL_DUPLICATE', 'Dubleret panelrelation', context);
  membershipPairs.add(key);
}

for (const status of statuses) {
  const context = `investor_status:${status.canonical_name ?? '?'}`;
  if (!required(status.canonical_name) || !required(status.slug)) report.blocker('INVESTOR_STATUS_IDENTITY', 'Investorstatus mangler kanonisk navn eller slug', context);
  if (!investorNames.has(status.canonical_name)) report.blocker('INVESTOR_STATUS_INVESTOR', 'Status peger på ukendt investor', context);
  const canonicalInvestor = investorByName.get(status.canonical_name);
  if (canonicalInvestor && status.slug !== canonicalInvestor.slug) report.blocker('INVESTOR_STATUS_SLUG', 'Investorstatus har en anden slug end investors-tabellen', context);
  if (!['aktiv', 'gaest', 'tidligere'].includes(status.status)) report.blocker('INVESTOR_STATUS_VALUE', `Ugyldig investorstatus: ${status.status}`, context);
  for (const season of status.panel_seasons || []) {
    if (!seasonIds.has(season)) report.blocker('INVESTOR_STATUS_SEASON', `Panelhistorik peger på ukendt sæson: ${season}`, context);
  }
}

const eventTypes = new Set([
  'renegotiated', 'cancelled', 'follow_on_investment', 'exit', 'bankruptcy',
  'closed', 'comeback', 'rebrand', 'funding_round', 'milestone', 'other',
]);
const datePrecisions = new Set(['day', 'month', 'year']);
function validCalendarDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
for (const event of events) {
  const context = `company_events:${event.id ?? '?'} ${event.title ?? ''}`.trim();
  if (!required(event.id)) report.blocker('EVENT_ID', 'Event mangler id', context);
  const company = companyBySlug.get(event.company?.slug);
  if (!company) report.blocker('EVENT_COMPANY', 'Event mangler gyldig virksomhed', context);
  if (!eventTypes.has(event.event_type)) report.blocker('EVENT_TYPE', `Manglende eller ugyldig eventtype: ${event.event_type}`, context);
  if (!datePrecisions.has(event.date_precision)) report.blocker('EVENT_PRECISION', `Ugyldig datopræcision: ${event.date_precision}`, context);
  if (!validCalendarDate(event.event_date)) report.blocker('EVENT_DATE', `Ugyldig eventdato: ${event.event_date}`, context);
  if (event.date_precision === 'year' && !String(event.event_date || '').endsWith('-01-01')) {
    report.blocker('EVENT_PRECISION_DATE', 'Årspræcision skal bruge 1. januar som neutral sorteringsdato', context);
  }
  if (event.date_precision === 'month' && !String(event.event_date || '').endsWith('-01')) {
    report.blocker('EVENT_PRECISION_DATE', 'Månedspræcision skal bruge månedens første dag som neutral sorteringsdato', context);
  }
  if (!required(event.title)) report.blocker('EVENT_TITLE', 'Event mangler titel', context);
  if (event.amount != null && (!Number.isFinite(event.amount) || event.amount < 0)) report.blocker('EVENT_AMOUNT', `Ugyldigt eventbeløb: ${event.amount}`, context);
  if (company && ['bankruptcy', 'closed'].includes(event.event_type) && company.status === 'aktiv') {
    report.blocker('EVENT_STATUS_CONFLICT', 'Konkurs/lukning modsiges af aktiv virksomhedsstatus', `${context}; companies:${company.id}`);
  }
}

const sourceTargets = {
  deal: dealIds,
  company: companyIds,
  investor: investorIds,
  company_event: eventIds,
  season: seasonIds,
};
const allowedConfidence = new Set(['confirmed', 'likely', 'uncertain']);
const sourcedEvents = new Set();
for (const source of sources) {
  const context = `sources:${source.id ?? '?'} ${source.source_name ?? ''}`.trim();
  if (!required(source.id)) report.blocker('SOURCE_ID', 'Kilde mangler id', context);
  const targetSet = sourceTargets[source.entity_type];
  if (!targetSet) report.blocker('SOURCE_TYPE', `Ugyldig entity_type: ${source.entity_type}`, context);
  else if (!targetSet.has(source.entity_id)) report.blocker('SOURCE_RELATION', `Kilde peger på ukendt ${source.entity_type}:${source.entity_id}`, context);
  if (!required(source.source_name)) report.blocker('SOURCE_NAME', 'Kilde mangler navn', context);
  // Interne afledninger og enkelte registerkilder kan legitimt mangle URL.
  // Hvis en URL findes, skal den følge samme http(s)-kontrakt som databasen og renderlaget.
  if (source.source_url != null && !/^https?:\/\//i.test(source.source_url)) report.blocker('SOURCE_URL', `Ugyldig source_url: ${source.source_url}`, context);
  if (!allowedConfidence.has(source.confidence)) report.blocker('SOURCE_CONFIDENCE', `Ugyldig confidence: ${source.confidence}`, context);
  if (source.entity_type === 'company_event') sourcedEvents.add(source.entity_id);
}
for (const event of events) {
  if (!sourcedEvents.has(event.id)) report.blocker('EVENT_WITHOUT_SOURCE', 'Event har ingen synlig kilde', `company_events:${event.id}`);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(archive.trykt || '')) report.warning('SNAPSHOT_DATE', `Ugyldig eller manglende trykdato: ${archive.trykt}`, file);

report.finish();
