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

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://hulensdata.dk';
const SUPABASE = 'https://upaxzfytumsijnbhjihd.supabase.co/rest/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYXh6Znl0dW1zaWpuYmhqaWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjEwMzIsImV4cCI6MjA5MDczNzAzMn0.GOB9cg8CWmC2Qn73Wg2A9AEoDrOKjB7IXZwndXwfKSk';
const TRYKT = new Date().toISOString().slice(0, 10);
const DATA_ONLY = process.argv.includes('--data-only');
const FROM_SNAPSHOT = process.argv.includes('--from-snapshot');

/* ── 1. Hent datagrundlaget (samme queries som klienten — arkiv.json
       skal kunne svare på præcis de kald, sbFetch stiller) ── */
async function hent(path) {
  const res = await fetch(`${SUPABASE}/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} på ${path}`);
  return res.json();
}

const QUERIES = {
  deals: 'deals?select=id,saeson,afsnit,soeger,andel_tilbudt,beloeb_modtaget,andel_solgt,aftale,company:companies(name,slug,category,status),deal_investors(investor:investors(canonical_name))&order=saeson.asc,afsnit.asc&limit=1000',
  deal_investors: 'deal_investors?select=deal_id,investor_id&order=deal_id.asc,investor_id.asc&limit=1000',
  investor_status: 'investor_status?select=canonical_name,slug,status,first_season,last_season,panel_seasons&order=canonical_name.asc',
  seasons: 'seasons?select=season_number,year&order=season_number.asc',
  companies: 'companies?select=id,name,slug,category,status,cvr_nummer&order=name.asc&limit=1000',
  company_events: 'company_events?select=id,event_date,date_precision,event_type,title,description,amount,created_at,updated_at,company:companies(slug)&order=event_date.asc&limit=1000',
  // limit er et klientønske; Supabase kan stadig håndhæve projektets server-side max-rows.
  sources: 'sources?select=id,entity_type,entity_id,field_name,source_name,source_url,note,confidence&limit=10000',
  panel_memberships: 'panel_memberships?select=season_number,investor_id,role',
  investors: 'investors?select=id,canonical_name,slug',
};

let arkiv;
if (FROM_SNAPSHOT) {
  arkiv = JSON.parse(readFileSync(join(ROD, 'data', 'arkiv.json'), 'utf8'));
} else {
  arkiv = { trykt: TRYKT };
  for (const [navn, q] of Object.entries(QUERIES)) arkiv[navn] = await hent(q);
}
if (arkiv.deals.length < 300) throw new Error('deals ser afkortet ud — trykning afbrudt');
mkdirSync(join(ROD, 'data'), { recursive: true });
writeFileSync(join(ROD, 'data', 'arkiv.json'), JSON.stringify(arkiv));
console.log(`arkiv.json: ${Object.entries(QUERIES).map(([n]) => `${n}=${arkiv[n].length}`).join(' ')}`);
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
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Archivo:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<script src="/js/layout.js"></script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
<a class="skip-link" href="#main-content">Spring til indhold</a>
<header class="site-header"></header>
<script>renderSiteHeader(${JSON.stringify(aktiv)});</script>
<main id="main-content" class="page-main">
${krop}
</main>
<footer class="site-footer"><span>Hulens Data · uofficielt dataarkiv · snapshot ${TRYKT.split('-').reverse().join('.')}</span><a href="/#metode">Metode og kilder</a></footer>
<script src="/js/helpers.js"></script>
<script src="/js/supabase.js"></script>
<script>loadDeals().then(renderHeaderStats).catch(function(){});</script>
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

/* ── 8. Sitemap ── */
const faste = ['/', '/deals.html', '/companies.html', '/investors.html', '/charts.html'];
writeFileSync(join(ROD, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  [...faste, ...stier].map(u => `  <url><loc>${HOST}${u}</loc><lastmod>${TRYKT}</lastmod></url>`).join('\n') +
  `\n</urlset>\n`);
console.log(`sitemap: ${faste.length + stier.length} URL'er · trykt ${TRYKT}`);
