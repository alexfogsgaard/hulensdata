#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'hulensdata-validation-'));
const publicEntries = [
  '404.html', 'index.html', 'deals.html', 'companies.html', 'investors.html', 'charts.html',
  'arkiv', 'virksomheder', 'loever', 'saesoner', 'metode', 'data',
  'sitemap.xml', 'robots.txt', '_redirects',
];

function run(script, args = []) {
  return spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: fixture,
    encoding: 'utf8',
  });
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function assertBlocked(result, code, label) {
  assert.notEqual(result.status, 0, `${label} skulle give en fejlet exit code`);
  assert.match(output(result), new RegExp(`\\b${code}\\b`), `${label} skulle rapportere ${code}`);
}

function mutateText(relativePath, mutation, script, code, label) {
  const path = join(fixture, relativePath);
  const original = readFileSync(path, 'utf8');
  try {
    const mutated = mutation(original);
    assert.notEqual(mutated, original, `${label} ændrede ikke testfilen`);
    writeFileSync(path, mutated);
    assertBlocked(run(script), code, label);
  } finally {
    writeFileSync(path, original);
    assert.equal(readFileSync(path, 'utf8'), original, `${label} blev ikke gendannet`);
  }
}

function mutateArchive(mutation, code, label, { shouldBlock = true, expectedText = '' } = {}) {
  const path = join(fixture, 'data/arkiv.json');
  const original = readFileSync(path, 'utf8');
  try {
    const archive = JSON.parse(original);
    mutation(archive);
    writeFileSync(path, JSON.stringify(archive));
    const result = run('tools/validate-data.mjs', [path]);
    if (shouldBlock) assertBlocked(result, code, label);
    else {
      assert.equal(result.status, 0, `${label} skulle bevare exit code 0\n${output(result)}`);
      if (expectedText) assert.match(output(result), new RegExp(expectedText), `${label} gav ikke den forventede rapport`);
    }
  } finally {
    writeFileSync(path, original);
    assert.equal(readFileSync(path, 'utf8'), original, `${label} blev ikke gendannet`);
  }
}

try {
  for (const entry of publicEntries) cpSync(join(root, entry), join(fixture, entry), { recursive: true });

  for (const script of ['tools/validate-data.mjs', 'tools/validate-build.mjs', 'tools/check-links.mjs', 'tools/check-seo.mjs']) {
    const result = run(script, script === 'tools/validate-data.mjs' ? [join(fixture, 'data/arkiv.json')] : []);
    assert.equal(result.status, 0, `Baseline fejlede for ${script}\n${output(result)}`);
  }

  mutateText('index.html', html => html.replace('</main>', '<a href="/review-missing/">Brudt testlink</a></main>'),
    'tools/check-links.mjs', 'LINK_TARGET', 'brudt internt link');
  mutateText('index.html', html => html.replace(/<link rel="canonical"[^>]*>\n?/, ''),
    'tools/check-seo.mjs', 'SEO_CANONICAL', 'manglende canonical');
  mutateText('index.html', html => html.replace(/(<script[^>]*type="application\/ld\+json"[^>]*>)[\s\S]*?(<\/script>)/i, '$1{ugyldig$2'),
    'tools/check-seo.mjs', 'SEO_JSONLD_PARSE', 'ugyldig JSON-LD');
  mutateText('sitemap.xml', xml => xml.replace(/(<url>[\s\S]*?<\/url>)/, '$1\n$1'),
    'tools/check-seo.mjs', 'SEO_SITEMAP_DUPLICATE', 'dubleret sitemap-URL');
  mutateText('index.html', html => html.replace('</main>', '<p>Eundefined</p></main>'),
    'tools/validate-build.mjs', 'BUILD_EUNDEFINED', 'Eundefined i output');
  mutateText('index.html', html => html.replace('</head>', '<meta name="review-mutation" content="NaN">\n</head>'),
    'tools/validate-build.mjs', 'BUILD_NAN', 'NaN i outputattribut');
  mutateText('_redirects', redirects => `${redirects.trimEnd()}\n/review-old /review-missing/ 301\n`,
    'tools/check-links.mjs', 'REDIRECT_TARGET', 'redirect til manglende mål');
  mutateText('index.html', html => html.replace('</main>', '<span id="main-content"></span></main>'),
    'tools/validate-build.mjs', 'BUILD_DUPLICATE_ID', 'dubleret HTML-id');

  mutateArchive(archive => { archive.companies[1].id = archive.companies[0].id; },
    'COMPANY_ID_DUPLICATE', 'dubleret primærnøgle');
  mutateArchive(archive => { archive.sources[0].entity_id = 999999; },
    'SOURCE_RELATION', 'forældreløs kilderelation');
  mutateArchive(archive => { archive.deals[0].soeger = -1; },
    'DEAL_AMOUNT', 'negativt beløb');
  mutateArchive(archive => { archive.deals[0].andel_tilbudt = 101; },
    'DEAL_SHARE', 'ejerandel over 100 procent');
  mutateArchive(archive => { archive.deals[0].aftale = 'true'; },
    'DEAL_OUTCOME_TYPE', 'ikke-boolsk aftaleudfald');
  mutateArchive(archive => { archive.company_events[0].event_date = '2026-99-99'; },
    'EVENT_DATE', 'ugyldig kalenderdato');
  mutateArchive(archive => { archive.companies[0].slug = 'Ugyldig slug'; },
    'COMPANY_SLUG', 'ugyldigt virksomhedsslug');
  mutateArchive(archive => { archive.companies[0].cvr_nummer = '1234'; },
    'COMPANY_CVR', 'ugyldigt CVR');
  mutateArchive(archive => { archive.deal_investors.pop(); },
    'DEAL_INVESTOR_SYNC', 'uoverensstemmelse mellem investorrelationer');
  mutateArchive(archive => {
    const eventId = archive.company_events[0].id;
    archive.sources = archive.sources.filter(source => !(source.entity_type === 'company_event' && source.entity_id === eventId));
  }, 'EVENT_WITHOUT_SOURCE', 'event uden synlig kilde');

  mutateArchive(archive => {
    const noDeal = archive.deals.find(deal => !deal.aftale);
    noDeal.afsnit = null;
    noDeal.soeger = null;
    noDeal.andel_tilbudt = null;
    const closedDeal = archive.deals.find(deal => deal.aftale);
    closedDeal.beloeb_modtaget = null;
    closedDeal.andel_solgt = null;
    archive.companies[0].category = null;
    archive.companies[0].cvr_nummer = null;
    archive.sources.find(source => source.source_url == null).source_url = null;
  }, '', 'legitime NULL-tilstande', { shouldBlock: false });
  mutateArchive(archive => { archive.trykt = 'ukendt'; }, '', 'warning uden blocker', {
    shouldBlock: false,
    expectedText: '\\[WARNING\\] SNAPSHOT_DATE',
  });

  console.log('Valideringsværn: 8 build/SEO-mutationer · 10 datablokkere · NULL og warning-exit verificeret · alle fixtures gendannet');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
