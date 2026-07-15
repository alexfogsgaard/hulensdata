#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   tools/tryk.mjs — TRYKPRESSEN
   Supabase → data/arkiv.json → statisk HTML → Netlify CDN.
   "Arkivet udgives som trykte bind. Det genereres ikke på forespørgsel."

   Genbrug frem for genimplementering: js/helpers.js og js/components.js
   er rene browser-globals uden DOM-afhængighed. Vi indlæser dem i en
   node:vm-sandkasse og kører de SAMME funktioner som browseren — én
   sandhed for markup. (Bevidst valgt frem for ESM-konvertering, som
   ville omstrukturere alle siders synkrone bootstrapping — se decisions
   2026-07-12. Eneste krav: komponenter forbliver DOM-frie; ellers
   fejler buildet højlydt her.)

   Kør: node tools/tryk.mjs   (output: virksomheder/ loever/ saesoner/
   data/arkiv.json sitemap.xml — alle gitignorede build-artefakter)
   ═══════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllPages } from './lib/paginated-fetch.mjs';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://hulensdata.dk';
const SUPABASE = 'https://upaxzfytumsijnbhjihd.supabase.co/rest/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYXh6Znl0dW1zaWpuYmhqaWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjEwMzIsImV4cCI6MjA5MDczNzAzMn0.GOB9cg8CWmC2Qn73Wg2A9AEoDrOKjB7IXZwndXwfKSk';
const TRYKT = new Date().toISOString().slice(0, 10);
const DATA_ONLY = process.argv.includes('--data-only');
const FROM_SNAPSHOT = process.argv.includes('--from-snapshot');

/* ── 1. Hent datagrundlaget (samme queries som klienten — arkiv.json
       skal kunne svare på præcis de kald, sbFetch stiller) ── */
const hentAlle = path => fetchAllPages(`${SUPABASE}/${path}`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
});

const QUERIES = {
  deals: 'deals?select=id,saeson,afsnit,soeger,andel_tilbudt,beloeb_modtaget,andel_solgt,aftale,company:companies(name,slug,category,status),deal_investors(investor:investors(canonical_name))&order=saeson.asc,afsnit.asc,id.asc',
  deal_investors: 'deal_investors?select=deal_id,investor_id&order=deal_id.asc,investor_id.asc',
  investor_status: 'investor_status?select=canonical_name,slug,status,first_season,last_season,panel_seasons&order=canonical_name.asc',
  seasons: 'seasons?select=season_number,year&order=season_number.asc',
  companies: 'companies?select=id,name,slug,category,status,cvr_nummer&order=name.asc,id.asc',
  company_events: 'company_events?select=id,event_date,date_precision,event_type,title,description,amount,created_at,updated_at,company:companies(slug)&order=event_date.asc,id.asc',
  sources: 'sources?select=id,entity_type,entity_id,field_name,source_name,source_url,note,confidence&order=id.asc',
  panel_memberships: 'panel_memberships?select=season_number,investor_id,role&order=season_number.asc,investor_id.asc',
  investors: 'investors?select=id,canonical_name,slug&order=canonical_name.asc,id.asc',
};

let arkiv;
if (FROM_SNAPSHOT) {
  arkiv = JSON.parse(readFileSync(join(ROD, 'data', 'arkiv.json'), 'utf8'));
} else {
  arkiv = { trykt: TRYKT };
  for (const [navn, q] of Object.entries(QUERIES)) arkiv[navn] = await hentAlle(q);
}
if (arkiv.deals.length < 300) throw new Error('deals ser afkortet ud — trykning afbrudt');
mkdirSync(join(ROD, 'data'), { recursive: true });
writeFileSync(join(ROD, 'data', 'arkiv.json'), JSON.stringify(arkiv));
console.log(`arkiv.json: ${Object.entries(QUERIES).map(([n]) => `${n}=${arkiv[n].length}`).join(' ')}`);

const searchCompanies = Object.fromEntries(arkiv.companies.map(company => [company.slug, company]));
const searchEventLabels = {
  renegotiated: 'Genforhandlet', cancelled: 'Samarbejde ophørt', follow_on_investment: 'Opfølgende investering',
  exit: 'Exit', bankruptcy: 'Konkurs', closed: 'Lukket', comeback: 'Comeback', rebrand: 'Rebranding',
  funding_round: 'Fundingrunde', milestone: 'Milepæl', other: 'Anden hændelse',
};
const searchIndex = [
  ...arkiv.companies.map(company => ({
    group: 'Virksomheder',
    type: 'Virksomhed',
    name: company.name,
    detail: [company.category || 'Kategori ikke dokumenteret', company.cvr_nummer ? `CVR ${company.cvr_nummer}` : null].filter(Boolean).join(' · '),
    url: `/virksomheder/${company.slug}/`,
    keywords: [company.name, company.slug, company.category, company.cvr_nummer, company.status].filter(Boolean),
  })),
  ...arkiv.investor_status.map(investor => ({
    group: 'Investorer',
    type: 'Investor',
    name: investor.canonical_name,
    detail: investor.status === 'aktiv' ? 'Aktiv investor' : investor.status === 'gaest' ? 'Gæsteinvestor' : 'Tidligere investor',
    url: `/loever/${investor.slug}/`,
    keywords: [investor.canonical_name, investor.slug, investor.status, ...(investor.panel_seasons || []).map(season => `sæson ${season}`)],
  })),
  ...arkiv.seasons.map(season => {
    const deals = arkiv.deals.filter(deal => deal.saeson === season.season_number);
    const closed = deals.filter(deal => deal.aftale).length;
    return {
      group: 'Sæsoner', type: 'Sæson', name: `Sæson ${season.season_number}`,
      detail: `${season.year} · ${deals.length} pitches · ${closed} TV-aftaler`,
      url: `/saesoner/${season.season_number}/`,
      keywords: [`sæson ${season.season_number}`, `season ${season.season_number}`, season.year],
    };
  }),
  ...[...new Set(arkiv.companies.map(company => company.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'da'))
    .map(category => ({
      group: 'Kategorier', type: 'Kategori', name: category,
      detail: `${arkiv.deals.filter(deal => deal.company.category === category).length} registrerede pitches`,
      url: `/deals.html?category=${encodeURIComponent(category)}`,
      keywords: [category, 'kategori'],
    })),
  ...[
    { slug: 'exits', name: 'Exits', types: ['exit'] },
    { slug: 'konkurser', name: 'Konkurser og lukninger', types: ['bankruptcy', 'closed'] },
    { slug: 'kollapsede-deals', name: 'Kollapsede deals', types: ['cancelled', 'renegotiated'] },
  ].map(register => ({
    group: 'Registre', type: 'Register', name: register.name,
    detail: `${arkiv.company_events.filter(event => register.types.includes(event.event_type)).length} dokumenterede hændelser`,
    url: `/arkiv/${register.slug}/`,
    keywords: [register.name, register.slug, ...register.types],
  })),
  ...arkiv.company_events.map(event => {
    const company = searchCompanies[event.company.slug];
    return {
      group: 'Dokumenterede hændelser', type: 'Hændelse',
      name: company ? `${company.name}: ${event.title}` : event.title,
      detail: `${searchEventLabels[event.event_type] || 'Hændelse'} · ${event.event_date.slice(0, 4)}`,
      url: company ? `/virksomheder/${company.slug}/#efterliv` : '/arkiv/',
      keywords: [company?.name, company?.cvr_nummer, event.title, event.description, event.event_type, searchEventLabels[event.event_type], event.event_date].filter(Boolean),
    };
  }),
  {
    group: 'Metode', type: 'Metode', name: 'Metode og datadækning',
    detail: 'Definitioner, kilder, confidence, NULL og dækning pr. sæson',
    url: '/metode/',
    keywords: ['metode', 'datadækning', 'kilder', 'confidence', 'null', 'cvr', 'rettelser'],
  },
].map(item => ({ ...item, keywords: [...new Set(item.keywords.map(String))] }));
writeFileSync(join(ROD, 'data', 'search-index.json'), JSON.stringify({ trykt: arkiv.trykt, items: searchIndex }));
console.log(`search-index.json: ${searchIndex.length} opslag`);
if (DATA_ONLY) process.exit(0);

// En lokal mappe kan rumme gamle, gitignorede profilsider efter slugskift.
// Ryd kun Trykpressens egne outputmapper, så lokal og ren Netlify-build er ens.
for (const outputDir of ['virksomheder', 'loever', 'saesoner']) {
  rmSync(join(ROD, outputDir), { recursive: true, force: true });
}

/* ── 2. Sandkassen: kør produktionskoden på build-data ── */
const ctx = createContext({ console });
for (const fil of ['js/helpers.js', 'js/supabase.js', 'js/components.js']) {
  runInContext(readFileSync(join(ROD, fil), 'utf8'), ctx, { filename: fil });
}
// sbFetch erstattes EFTER indlæsning: opslag i arkivet i stedet for netværk
ctx.__arkiv = arkiv;
runInContext(`sbFetch = async (path) => {
  const key = path.split('?')[0];
  if (!__arkiv[key]) throw new Error('ukendt tabel i arkiv: ' + key);
  return __arkiv[key];
};`, ctx);
const allDeals = await runInContext('loadDeals()', ctx);
await runInContext('loadCompanyArchive()', ctx);
ctx.__deals = allDeals;
const kald = (udtryk) => runInContext(udtryk, ctx);

/* ── 3. Sideskabelonen (head/chrome/foot — kroppen kommer fra komponenterne) ── */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function side({ sti, titel, beskrivelse, jsonld, krop, aktiv = null, type = 'article' }) {
  const url = HOST + sti;
  const headerStats = `${arkiv.deals.length} pitches · ${arkiv.deals.filter(deal => deal.aftale).length} aftaler`;
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beskrivelse)}">
<link rel="canonical" href="${url}">
<meta property="og:site_name" content="Hulens Data">
<meta property="og:locale" content="da_DK">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beskrivelse)}">
<meta property="og:url" content="${url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Archivo:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<script src="/js/layout.js"></script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
<a class="skip-link" href="#main-content">Spring til indhold</a>
<header class="site-header"></header>
<script>renderSiteHeader(${JSON.stringify(aktiv)}, ${JSON.stringify(headerStats)});</script>
<main id="main-content" class="page-main">
${krop}
</main>
<footer class="site-footer"><span>Hulens Data · uofficielt dataarkiv · snapshot ${TRYKT.split('-').reverse().join('.')}</span><a href="/metode/">Metode og datadækning</a></footer>
</body>
</html>`;
}

function skriv(sti, html) {
  mkdirSync(join(ROD, sti), { recursive: true });
  writeFileSync(join(ROD, sti, 'index.html'), html);
}

const brodkrumme = (navn, sti) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Hulens Data', item: HOST + '/' },
    { '@type': 'ListItem', position: 2, name: navn, item: HOST + sti },
  ],
});

/* ── 4. Virksomhedsbindene ── */
const stier = [];
for (const co of arkiv.companies) {
  const sti = `/virksomheder/${co.slug}/`;
  ctx.__navn = co.name;
  const p = kald('buildCompanyProfile(__navn, __deals)');
  if (!p) continue;
  ctx.__p = p;
  const krop = `<a class="back-btn" href="/companies.html">← Virksomhedsregisteret</a>\n` + kald('renderCompanyProfile(__p)');
  const d = p.latest;
  const episode = d.episode == null ? '' : `, afsnit ${d.episode}`;
  const beskrivelse = (d.received
    ? `Løvens Hule sæson ${d.season}${episode}: ${d.asked == null ? 'søgt beløb ikke dokumenteret' : `søgte kr ${Number(d.asked).toLocaleString('da-DK')}`}, fik kr ${Number(d.received).toLocaleString('da-DK')}${d.shareSold == null ? '' : ` for ${d.shareSold} %`} — ${p.investors.join(', ')}.`
    : `Pitchede i Løvens Hule sæson ${d.season}${episode} uden aftale.`)
    + (p.events.length ? ' Se efterliv, kilder og kapitalhistorik.' : ' Se kapitalhistorik og kilder.');
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: co.name, url: HOST + sti,
      ...(co.cvr_nummer ? { identifier: { '@type': 'PropertyValue', propertyID: 'CVR', value: co.cvr_nummer } } : {}) },
    { '@context': 'https://schema.org', ...brodkrumme(co.name, sti) },
  ];
  skriv(sti.slice(1), side({ sti, titel: `${co.name} — Løvens Hule S${d.season} | Hulens Data`, beskrivelse, jsonld, krop, aktiv: 'companies' }));
  stier.push(sti);
}
console.log(`virksomheder: ${arkiv.companies.length} bind`);

/* ── 5. Løvebindene ── */
const idx = kald('buildInvestorIndex(__deals)');
for (const m of idx.investors) {
  const st = arkiv.investor_status.find(i => i.canonical_name === m.name);
  if (!st) continue;
  const sti = `/loever/${st.slug}/`;
  ctx.__m = m; ctx.__latest = idx.latestSeason;
  const krop = `<a class="back-btn" href="/investors.html">← Alle løver</a>\n` +
    kald('renderInvestorProfile(buildInvestorProfile(__m, __deals), __latest)');
  const beskrivelse = `${m.name} i Løvens Hule: ${m.deals} registrerede TV-aftaler og kr ${Number(m.received).toLocaleString('da-DK')} i registreret TV-beløb på tværs af sæson ${m.panelSeasons.join(', ')}.`;
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Person', name: m.name, url: HOST + sti, jobTitle: 'Investor, Løvens Hule (DR)' },
    { '@context': 'https://schema.org', ...brodkrumme(m.name, sti) },
  ];
  skriv(sti.slice(1), side({ sti, titel: `${m.name} — TV-aftaler i Løvens Hule | Hulens Data`, beskrivelse, jsonld, krop, aktiv: 'investors' }));
  stier.push(sti);
}
console.log(`loever: ${idx.investors.length} bind`);

/* ── 6. Sæsonbindene ── */
const invAfId = Object.fromEntries(arkiv.investors.map(i => [i.id, i]));
for (const s of arkiv.seasons) {
  const n = s.season_number;
  const sti = `/saesoner/${n}/`;
  const sd = allDeals.filter(d => d.season === n);
  const lukket = sd.filter(d => d.received);
  const sum = lukket.reduce((a, d) => a + d.received, 0);
  const panel = arkiv.panel_memberships.filter(pm => pm.season_number === n)
    .map(pm => ({ ...invAfId[pm.investor_id], role: pm.role }))
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, 'da'));
  const dealNames = new Set(sd.map(d => d.name));
  const seasonEvents = arkiv.company_events
    .filter(e => dealNames.has(arkiv.companies.find(c => c.slug === e.company.slug)?.name))
    .sort((a, b) => b.event_date.localeCompare(a.event_date))
    .map(event => ({
      companyName: arkiv.companies.find(c => c.slug === event.company.slug).name,
      event: { ...event, sources: arkiv.sources.filter(src => src.entity_type === 'company_event' && src.entity_id === event.id) },
    }));
  const eventCounts = seasonEvents.reduce((counts, item) => {
    counts[item.companyName] = (counts[item.companyName] || 0) + 1;
    return counts;
  }, {});
  ctx.__seasonProfile = {
    season: n,
    year: s.year,
    deals: sd.map(deal => ({ ...deal, afterlifeCount: eventCounts[deal.name] || 0 })),
    closedCount: lukket.length,
    amount: sum,
    panel: panel.map(person => ({ name: person.canonical_name, slug: person.slug, role: person.role })),
    events: seasonEvents,
    previous: arkiv.seasons.some(item => item.season_number === n - 1) ? n - 1 : null,
    next: arkiv.seasons.some(item => item.season_number === n + 1) ? n + 1 : null,
  };
  const krop = `<a class="back-btn" href="/#saesoner">← Alle sæsoner</a>\n` + kald('renderSeasonProfile(__seasonProfile)');
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'TVSeason', name: `Løvens Hule sæson ${n}`, seasonNumber: n,
      partOfSeries: { '@type': 'TVSeries', name: 'Løvens Hule' }, url: HOST + sti },
    { '@context': 'https://schema.org', ...brodkrumme(`Sæson ${n}`, sti) },
  ];
  skriv(sti.slice(1), side({ sti, titel: `Løvens Hule sæson ${n} (${s.year}): alle deals og investeringer | Hulens Data`,
    beskrivelse: `Sæson ${n} af Løvens Hule (${s.year}): ${sd.length} registrerede pitches, ${lukket.length} TV-aftaler og kr ${Number(sum).toLocaleString('da-DK')} i registreret TV-beløb.`, jsonld, krop, aktiv: 'seasons' }));
  stier.push(sti);
}
console.log(`saesoner: ${arkiv.seasons.length} bind`);

/* ── 7. Registrene (/arkiv/) — tematiske opslag over efterlivet.
       Genereres KUN af dokumenterede events/kilder (hændelser, ikke
       narrativer); tomme registre trykkes ikke. ── */
const REGISTRE = [
  { slug: 'konkurser', titel: 'Konkurser og lukninger', types: ['bankruptcy', 'closed'],
    sideTitel: 'Løvens Hule-virksomheder der gik konkurs — registret',
    intro: 'Virksomheder fra Løvens Hule, hvor arkivet har dokumenteret konkurs eller lukning — med dato, TV-dealens tal og kilder.' },
  { slug: 'exits', titel: 'Exits', types: ['exit'],
    sideTitel: 'Exits fra Løvens Hule — solgte virksomheder — registret',
    intro: 'Virksomheder fra Løvens Hule, der siden er blevet solgt — dokumenteret med kilder.' },
  { slug: 'kollapsede-deals', titel: 'Kollapsede deals', types: ['cancelled', 'renegotiated'],
    sideTitel: 'Løvens Hule-deals der kollapsede eller blev genforhandlet — registret',
    intro: 'TV-deals der blev genforhandlet eller aldrig blev til virkelighed, efter kameraerne slukkede — med kilder.' },
];

const coAfSlug = Object.fromEntries(arkiv.companies.map(c => [c.slug, c]));
const kilderFor = (type, id) => arkiv.sources.filter(s => s.entity_type === type && s.entity_id === id);
const dealResume = (name) => {
  const ds = allDeals.filter(d => d.name === name);
  if (!ds.length) return '';
  const d = ds[ds.length - 1];
  return d.received
    ? `TV-deal S${d.season} (${arkiv.seasons.find(s => s.season_number === d.season)?.year ?? ''}): kr ${Number(d.received).toLocaleString('da-DK')} for ${d.shareSold} % — ${[...new Set(ds.flatMap(x => x.investorList))].join(', ')}`
    : `Pitchede S${d.season} uden aftale`;
};

const registerStier = [];
for (const reg of REGISTRE) {
  const events = arkiv.company_events
    .filter(e => reg.types.includes(e.event_type))
    .sort((a, b) => b.event_date.localeCompare(a.event_date));
  // Konkurs-registret medtager også registerfakta uden kurateret event:
  // companies m. status=inaktiv og kildebelagt status-felt (CVR/presse)
  const eventSlugs = new Set(events.map(e => e.company.slug));
  const registerFakta = reg.slug === 'konkurser'
    ? arkiv.sources.filter(s => s.entity_type === 'company' && s.field_name === 'status')
        .map(s => ({ ...s, co: arkiv.companies.find(c => c.id === s.entity_id) }))
        .filter(x => x.co && x.co.status === 'inaktiv' && !eventSlugs.has(x.co.slug))
    : [];
  if (!events.length && !registerFakta.length) continue;

  const poster = events.map(e => {
    const co = coAfSlug[e.company.slug];
    ctx.__registerItem = { companyName: co.name, dealSummary: dealResume(co.name), event: { ...e, sources: kilderFor('company_event', e.id) } };
    return kald('renderRegisterEntry(__registerItem)');
  }).join('\n');

  const faktaListe = registerFakta.length ? `
<section class="profile-section register-facts">
  <div class="section-heading"><span class="section-kicker">Registerstatus uden hændelsesklassifikation</span><h2>Inaktive selskaber i kildedata</h2><p>Disse selskaber har en kildebelagt inaktiv status, men arkivet har endnu ikke en kurateret konkurs- eller lukningshændelse. De tælles derfor ikke som dokumenterede hændelser ovenfor.</p></div>
  <div class="register-links">${registerFakta.map(x => `<a href="/virksomheder/${x.co.slug}/"><span>${esc(x.co.name)}</span><small>${esc(x.source_name)}</small><strong aria-hidden="true">→</strong></a>`).join('')}</div>
</section>` : '';

  const sti = `/arkiv/${reg.slug}/`;
  const antal = events.length;
  const krop = `<a class="back-btn" href="/arkiv/">← Alle registre</a>
<header class="index-header"><p class="section-kicker">Tematisk register</p><h1 class="page-title">${reg.titel}</h1><p>${reg.intro} Registret rummer <b class="num">${antal}</b> dokumenterede hændelser og vokser i takt med kurateringen.</p></header>
<div class="register-entries">${poster}</div>
${faktaListe}`;
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: reg.sideTitel, url: HOST + sti },
    { '@context': 'https://schema.org', ...brodkrumme(reg.titel, sti) },
  ];
  skriv(sti.slice(1), side({ sti, titel: `${reg.sideTitel} | Hulens Data`,
    beskrivelse: `${reg.intro} ${antal} dokumenterede hændelser pr. ${TRYKT.split('-').reverse().join('.')}.`, jsonld, krop, aktiv: 'archive' }));
  registerStier.push({ sti, titel: reg.titel, antal });
  stier.push(sti);
}

// Registrenes forside (/arkiv/)
if (registerStier.length) {
  const krop = `<a class="back-btn" href="/">← Forsiden</a>
<header class="index-header"><p class="section-kicker">Efter kameraerne</p><h1 class="page-title">Tematiske registre</h1><p>Hvad der skete efter udsendelsen, på tværs af virksomhederne. Kun dokumenterede hændelser med synlige kilder.</p></header>
<div class="register-links">${registerStier.map(r => `<a href="${r.sti}"><span>${r.titel}</span><small>Dokumenterede hændelser</small><strong class="num">${r.antal}</strong></a>`).join('')}</div>`;
  skriv('arkiv/', side({ sti: '/arkiv/', titel: 'Registrene — konkurser, exits og kollapsede deals fra Løvens Hule | Hulens Data',
    beskrivelse: 'Tematiske registre over efterlivet i Løvens Hule: konkurser, exits og kollapsede deals — dokumenteret med kilder.',
    jsonld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Registrene', url: HOST + '/arkiv/' },
             { '@context': 'https://schema.org', ...brodkrumme('Registrene', '/arkiv/') }], krop, aktiv: 'archive', type: 'website' }));
  stier.push('/arkiv/');
  console.log(`registre: ${registerStier.length} opslag (${registerStier.map(r => `${r.titel.toLowerCase()}=${r.antal}`).join(' ')})`);
}

/* ── 8. Metode og datadækning ── */
const companyIdToSlug = Object.fromEntries(arkiv.companies.map(company => [company.id, company.slug]));
const dealIdToSlug = Object.fromEntries(arkiv.deals.map(deal => [deal.id, deal.company.slug]));
const eventIdToSlug = Object.fromEntries(arkiv.company_events.map(event => [event.id, event.company.slug]));
const companiesWithSources = new Set();
for (const source of arkiv.sources) {
  const slug = source.entity_type === 'company' ? companyIdToSlug[source.entity_id]
    : source.entity_type === 'deal' ? dealIdToSlug[source.entity_id]
      : source.entity_type === 'company_event' ? eventIdToSlug[source.entity_id]
        : null;
  if (slug) companiesWithSources.add(slug);
}
const companiesWithEvents = new Set(arkiv.company_events.map(event => event.company.slug));
const closedDeals = arkiv.deals.filter(deal => deal.aftale);
const coveragePercent = (known, total) => total ? `${Math.round(known / total * 100)} %` : 'Ikke relevant';
const coverageValue = (known, total) => `${known} af ${total} · ${coveragePercent(known, total)}`;
const coverageCard = (label, known, total, note) => `
  <div><dt>${esc(label)}</dt><dd class="num">${esc(coverageValue(known, total))}</dd><span>${esc(note)}</span></div>`;

const coverageCards = [
  coverageCard('Pitches med kendt afsnit', arkiv.deals.filter(deal => deal.afsnit != null).length, arkiv.deals.length, 'Ukendt afsnit bevares som NULL.'),
  coverageCard('Pitches med kendt søgt beløb', arkiv.deals.filter(deal => deal.soeger != null).length, arkiv.deals.length, 'Manglende beløb estimeres ikke.'),
  coverageCard('TV-aftaler med kendt beløb', closedDeals.filter(deal => deal.beloeb_modtaget != null).length, closedDeals.length, 'Vilkår vist i udsendelsen.'),
  coverageCard('TV-aftaler med kendt ejerandel', closedDeals.filter(deal => deal.andel_solgt != null).length, closedDeals.length, 'Kun registreret andel i TV-aftalen.'),
  coverageCard('Virksomheder med CVR', arkiv.companies.filter(company => company.cvr_nummer).length, arkiv.companies.length, 'CVR indsættes kun ved dokumenteret match.'),
  coverageCard('Virksomheder med mindst én kilde', companiesWithSources.size, arkiv.companies.length, 'Kilde på virksomhed, pitch eller efterliv tæller.'),
  coverageCard('Virksomheder med dokumenteret efterliv', companiesWithEvents.size, arkiv.companies.length, 'Fravær af event er ikke bevis for manglende udvikling.'),
].join('');

const seasonCoverageRows = arkiv.seasons.map(season => {
  const deals = arkiv.deals.filter(deal => deal.saeson === season.season_number);
  const companySlugs = new Set(deals.map(deal => deal.company.slug));
  const dealsClosed = deals.filter(deal => deal.aftale);
  const cvrCompanies = [...companySlugs].filter(slug => coAfSlug[slug]?.cvr_nummer).length;
  const eventCompanies = [...companySlugs].filter(slug => companiesWithEvents.has(slug)).length;
  return `<tr>
    <th scope="row">Sæson ${season.season_number}<small>${season.year}</small></th>
    <td class="num">${deals.length}</td>
    <td class="num">${coverageValue(deals.filter(deal => deal.afsnit != null).length, deals.length)}</td>
    <td class="num">${coverageValue(deals.filter(deal => deal.soeger != null).length, deals.length)}</td>
    <td class="num">${coverageValue(dealsClosed.filter(deal => deal.andel_solgt != null).length, dealsClosed.length)}</td>
    <td class="num">${coverageValue(cvrCompanies, companySlugs.size)}</td>
    <td class="num">${coverageValue(eventCompanies, companySlugs.size)}</td>
  </tr>`;
}).join('');

const confidenceCounts = ['confirmed', 'likely', 'uncertain'].map(confidence => ({
  confidence,
  count: arkiv.sources.filter(source => source.confidence === confidence).length,
}));
const confidenceLabels = { confirmed: 'Bekræftet', likely: 'Sandsynlig', uncertain: 'Usikker' };
const confidenceRows = confidenceCounts.map(item => `<tr><th scope="row">${confidenceLabels[item.confidence]}</th><td class="num">${item.count}</td><td class="num">${coveragePercent(item.count, arkiv.sources.length)}</td></tr>`).join('');

const methodPath = '/metode/';
const methodBody = `<a class="back-btn" href="/">← Forsiden</a>
<article class="method-page company-profile">
  <header class="company-profile-header method-header">
    <div class="profile-eyebrow">Metode · snapshot ${TRYKT.split('-').reverse().join('.')}</div>
    <h1>Sådan arbejder arkivet</h1>
    <p>Definitioner, kildekrav og den aktuelle datadækning bag Hulens Data. Tallene nedenfor beregnes ved hver trykning og er ikke skrevet ind manuelt.</p>
  </header>

  <nav class="profile-nav" aria-label="På denne side"><a href="#definitioner">Definitioner</a><a href="#kilder">Kilder og confidence</a><a href="#daekning">Datadækning</a><a href="#saesoner">Sæsoner</a><a href="#rettelser">Rettelser</a></nav>

  <section class="profile-section" id="definitioner">
    <div class="section-heading"><span class="section-kicker">01 · Datakontrakt</span><h2>Hvad arkivet registrerer</h2><p>TV-øjeblikket og tiden efter udsendelsen er to forskellige datalag.</p></div>
    <div class="method-definition-grid">
      <div><h3>Pitch</h3><p>En registreret virksomhedsoptræden i programmet. Samme virksomhed kan have flere pitches. Ukendt afsnit forbliver ukendt.</p></div>
      <div><h3>Registreret TV-aftale</h3><p>De vilkår, der er registreret fra udsendelsen: beløb, ejerandel og investorer. Det betyder ikke automatisk, at investeringen blev realiseret efter optagelsen.</p></div>
      <div><h3>Flere investorer</h3><p>Hver investor knyttes som en selvstændig relation til samme TV-aftale. Aftalebeløbet summeres ikke én gang pr. investor.</p></div>
      <div><h3>Kollapset eller ændret aftale</h3><p>En senere genforhandling eller ophør registreres som en efterlivshændelse. Den overskriver ikke det dokumenterede TV-øjeblik.</p></div>
      <div><h3>Efterlivshændelse</h3><p>En daterbar, kildebelagt begivenhed efter udsendelsen, eksempelvis exit, konkurs, lukning, funding, ejerskifte eller milepæl.</p></div>
      <div><h3>NULL</h3><p>NULL betyder, at arkivet ikke har tilstrækkelig dokumentation. Ukendte afsnit, datoer, beløb, ejerandele, CVR og status bliver ikke udfyldt ved gæt.</p></div>
    </div>
  </section>

  <section class="profile-section" id="kilder">
    <div class="section-heading"><span class="section-kicker">02 · Kildekritik</span><h2>Kilder, confidence og datopræcision</h2><p>Kilder knyttes til den konkrete entitet eller det konkrete felt, de understøtter.</p></div>
    <div class="documentation-grid method-source-grid">
      <div>
        <h3>Confidence</h3>
        <dl class="method-confidence"><div><dt>Bekræftet</dt><dd>Primærkilde eller flere uafhængige kilder er enige.</dd></div><div><dt>Sandsynlig</dt><dd>Én troværdig kilde eller en dokumenteret afledning.</dd></div><div><dt>Usikker</dt><dd>Kilder er uenige, eller dokumentationen er svag. Uenige tal vises som spænd.</dd></div></dl>
      </div>
      <div>
        <h3>Kildegrænser</h3>
        <p>Aggregatorer som grundigt.dk bruges som kontrol- og leadkilder. Centrale exit-, konkurs- og beløbsoplysninger publiceres ikke alene på baggrund af et aggregatorfund.</p>
        <p>Datoer vises med den dokumenterede præcision: dag, måned eller år. Arkivet opfinder ikke en dag for at udfylde et datoformat.</p>
        <p>En oplysning publiceres ikke, når identiteten er tvetydig, kilden ikke kan efterprøves, eller påstanden kræver en årsagsforklaring, kilden ikke bærer.</p>
      </div>
    </div>
    <div class="table-wrap method-table" role="region" tabindex="0" aria-label="Kilder fordelt på confidence"><table><caption>Kilder fordelt på confidence</caption><thead><tr><th>Confidence</th><th class="num">Kilder</th><th class="num">Andel</th></tr></thead><tbody>${confidenceRows}</tbody></table></div>
  </section>

  <section class="profile-section" id="daekning">
    <div class="section-heading"><span class="section-kicker">03 · Aktuelt snapshot</span><h2>Datadækning</h2><p>Dækning måler, hvor meget arkivet kan dokumentere — ikke kvaliteten eller succesen af virksomhederne.</p></div>
    <dl class="method-coverage-grid">${coverageCards}</dl>
  </section>

  <section class="profile-section" id="saesoner">
    <div class="section-heading"><span class="section-kicker">04 · Sæsoner</span><h2>Dækning pr. sæson</h2><p>Sæson 1–4 mangler systematisk flere afviste pitches. Antal og aftaleandele kan derfor ikke sammenlignes direkte med senere sæsoner.</p></div>
    <div class="table-wrap method-table" role="region" tabindex="0" aria-label="Datadækning pr. sæson"><table><caption>Datadækning pr. sæson</caption><thead><tr><th>Sæson</th><th class="num">Pitches</th><th class="num">Kendt afsnit</th><th class="num">Kendt søgt beløb</th><th class="num">Kendt aftaleandel</th><th class="num">CVR</th><th class="num">Efterliv</th></tr></thead><tbody>${seasonCoverageRows}</tbody></table></div>
    <p class="context-note">CVR og efterliv beregnes på unikke virksomheder i sæsonen. En virksomhed med flere pitches tæller én gang i disse to kolonner.</p>
  </section>

  <section class="profile-section" id="rettelser">
    <div class="section-heading"><span class="section-kicker">05 · Revision</span><h2>Sådan foretages rettelser</h2></div>
    <div class="method-definition-grid">
      <div><h3>1. Påstanden afgrænses</h3><p>Det afgøres, om rettelsen vedrører TV-pitchen, virksomhedens identitet eller en efterlivshændelse. Fakta flyttes ikke mellem datalag.</p></div>
      <div><h3>2. Kilden efterprøves</h3><p>En samtidig primærkilde foretrækkes. Aggregatorer bruges til at finde spor, ikke som automatisk slutdokumentation.</p></div>
      <div><h3>3. Data og note opdateres</h3><p>Den kanoniske værdi rettes ét sted. Kilden får confidence, og væsentlige korrektioner dokumenterer den tidligere værdi i noten.</p></div>
      <div><h3>4. Arkivet trykkes igen</h3><p>Datavalidering, statisk build, links, redirects, canonical og JSON-LD kontrolleres før det nye snapshot publiceres.</p></div>
    </div>
    <p class="unofficial-note">Hulens Data er uofficielt og uafhængigt. Arkivet publicerer kun det, det aktuelle kildelag kan bære.</p>
  </section>
</article>`;
const methodJsonLd = [
  { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Metode og datadækning', url: HOST + methodPath,
    description: 'Definitioner, kildekritik, confidence, NULL-håndtering og aktuel datadækning for Hulens Data.' },
  { '@context': 'https://schema.org', ...brodkrumme('Metode og datadækning', methodPath) },
];
skriv('metode/', side({ sti: methodPath, titel: 'Metode og datadækning — Hulens Data',
  beskrivelse: 'Sådan registrerer og dokumenterer Hulens Data pitches, TV-aftaler, efterliv, kilder, confidence, NULL og CVR — med aktuel dækning pr. sæson.',
  jsonld: methodJsonLd, krop: methodBody, aktiv: 'method', type: 'website' }));
stier.push(methodPath);
console.log('metode: dækning genereret');

/* ── 9. Sitemap ── */
const faste = ['/', '/deals.html', '/companies.html', '/investors.html', '/charts.html'];
writeFileSync(join(ROD, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  [...faste, ...stier].map(u => `  <url><loc>${HOST}${u}</loc><lastmod>${TRYKT}</lastmod></url>`).join('\n') +
  `\n</urlset>\n`);
console.log(`sitemap: ${faste.length + stier.length} URL'er · trykt ${TRYKT}`);
