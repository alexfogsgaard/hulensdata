#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createReport } from './lib/report.mjs';
import { extractIds, listPublicHtml, readHtml, routeForFile, stripNonVisibleHtml } from './lib/site.mjs';

const root = process.cwd();
const report = createReport('Buildvalidering');
const archivePath = join(root, 'data', 'arkiv.json');

let archive;
try {
  archive = JSON.parse(readFileSync(archivePath, 'utf8'));
} catch (error) {
  report.blocker('BUILD_DATA', `Kunne ikke læse buildets arkiv.json: ${error.message}`, 'data/arkiv.json');
  report.finish();
  process.exit();
}

function requireFile(path, code, message) {
  if (!existsSync(path)) report.blocker(code, message, relative(root, path));
}

requireFile(join(root, '404.html'), 'BUILD_404', '404-side mangler');
requireFile(join(root, 'sitemap.xml'), 'BUILD_SITEMAP', 'sitemap.xml mangler');
requireFile(join(root, 'robots.txt'), 'BUILD_ROBOTS', 'robots.txt mangler');

for (const company of archive.companies || []) {
  requireFile(join(root, 'virksomheder', company.slug, 'index.html'), 'BUILD_COMPANY_PAGE', 'Virksomhedsside mangler');
}
for (const investor of archive.investors || []) {
  requireFile(join(root, 'loever', investor.slug, 'index.html'), 'BUILD_INVESTOR_PAGE', 'Investorprofil mangler');
}
for (const season of archive.seasons || []) {
  requireFile(join(root, 'saesoner', String(season.season_number), 'index.html'), 'BUILD_SEASON_PAGE', 'Sæsonside mangler');
}

const expectedCounts = {
  virksomheder: (archive.companies || []).length,
  loever: (archive.investors || []).length,
  saesoner: (archive.seasons || []).length,
};
for (const [dir, expected] of Object.entries(expectedCounts)) {
  const path = join(root, dir);
  const actual = existsSync(path)
    ? readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(path, entry.name, 'index.html'))).length
    : 0;
  if (actual !== expected) report.blocker('BUILD_PAGE_COUNT', `Forventede ${expected} sider, fandt ${actual}`, dir);
}

const publicFiles = listPublicHtml(root);
for (const file of publicFiles) {
  const rel = relative(root, file);
  const html = readHtml(file);
  const route = routeForFile(root, file);
  if (!/<main\b[^>]*id=["']main-content["']/i.test(html)) report.blocker('BUILD_MAIN', 'Siden mangler main-region med id="main-content"', rel);
  if (!/<a\b[^>]*class=["'][^"']*skip-link[^"']*["'][^>]*href=["']#main-content["']/i.test(html)) report.blocker('BUILD_SKIP_LINK', 'Siden mangler statisk skip-link til #main-content', rel);
  if (!/<header\b[^>]*class=["'][^"']*site-header/i.test(html)) report.blocker('BUILD_HEADER', 'Siden mangler fælles site-header', rel);
  if (/\son(?:click|input|change|keydown|keyup)\s*=/i.test(html)) report.blocker('BUILD_INLINE_HANDLER', 'Inline event-handler bryder komponentkontrakten', rel);

  const ids = [...extractIds(html)];
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of new Set(duplicates)) report.blocker('BUILD_DUPLICATE_ID', `Dubleret id="${id}"`, rel);

  const visible = stripNonVisibleHtml(html);
  const badPatterns = [
    ['BUILD_EUNDEFINED', /Eundefined/],
    ['BUILD_UNDEFINED', /\bundefined\b/],
    ['BUILD_NAN', /\bNaN\b/],
    ['BUILD_NULL_MONEY', /(?:null\s*kr\.|kr\.?\s*null)/i],
  ];
  for (const [code, pattern] of badPatterns) {
    if (pattern.test(visible)) report.blocker(code, `Fejltekst matchede ${pattern}`, `${rel} (${route})`);
  }
}

const registerDefinitions = [
  { slug: 'konkurser', types: new Set(['bankruptcy', 'closed']) },
  { slug: 'exits', types: new Set(['exit']) },
  { slug: 'kollapsede-deals', types: new Set(['cancelled', 'renegotiated']) },
];
for (const register of registerDefinitions) {
  const expected = (archive.company_events || []).filter(event => register.types.has(event.event_type)).length;
  const file = join(root, 'arkiv', register.slug, 'index.html');
  if (!existsSync(file)) {
    if (expected) report.blocker('BUILD_REGISTER', `Register mangler trods ${expected} hændelser`, register.slug);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const rendered = Number(html.match(/Registret rummer\s*<b[^>]*>(\d+)<\/b>/i)?.[1]);
  if (rendered !== expected) report.blocker('BUILD_REGISTER_TOTAL', `Register viser ${rendered}, snapshot forventer ${expected}`, register.slug);
}

report.finish();
