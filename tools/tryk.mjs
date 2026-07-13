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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://hulensdata.dk';
const SUPABASE = 'https://upaxzfytumsijnbhjihd.supabase.co/rest/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYXh6Znl0dW1zaWpuYmhqaWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjEwMzIsImV4cCI6MjA5MDczNzAzMn0.GOB9cg8CWmC2Qn73Wg2A9AEoDrOKjB7IXZwndXwfKSk';
const TRYKT = new Date().toISOString().slice(0, 10);

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
  investor_status: 'investor_status?select=canonical_name,slug,status,first_season,last_season,panel_seasons&order=canonical_name.asc',
  seasons: 'seasons?select=season_number,year&order=season_number.asc',
  companies: 'companies?select=id,name,slug,category,status,cvr_nummer&order=name.asc&limit=1000',
  company_events: 'company_events?select=id,event_date,date_precision,event_type,title,description,amount,created_at,updated_at,company:companies(slug)&order=event_date.asc&limit=1000',
  sources: 'sources?select=id,entity_type,entity_id,field_name,source_name,source_url,note,confidence&limit=10000',
  panel_memberships: 'panel_memberships?select=season_number,investor_id,role',
  investors: 'investors?select=id,canonical_name,slug',
};

const arkiv = { trykt: TRYKT };
for (const [navn, q] of Object.entries(QUERIES)) arkiv[navn] = await hent(q);
if (arkiv.deals.length < 300) throw new Error('deals ser afkortet ud — trykning afbrudt');
mkdirSync(join(ROD, 'data'), { recursive: true });
writeFileSync(join(ROD, 'data', 'arkiv.json'), JSON.stringify(arkiv));
console.log(`arkiv.json: ${Object.entries(QUERIES).map(([n]) => `${n}=${arkiv[n].length}`).join(' ')}`);

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

function side({ sti, titel, beskrivelse, jsonld, krop }) {
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
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beskrivelse)}">
<meta property="og:url" content="${url}">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<script src="/js/layout.js"></script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
<header class="site-header"></header>
<script>renderSiteHeader(null);</script>
<main class="page-main">
${krop}
<footer class="tryk-kolofon">Hulens Data · arkivet over dansk iværksætteri på TV · trykt ${TRYKT.split('-').reverse().join('.')}</footer>
</main>
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
  const krop = `<a class="back-btn" href="/companies.html">← Alle virksomheder</a>\n` + kald('renderCompanyProfile(__p)');
  const d = p.latest;
  const beskrivelse = (d.received
    ? `Løvens Hule S${d.season} (${arkiv.seasons.find(s => s.season_number === d.season)?.year ?? ''}): søgte kr ${Number(d.asked).toLocaleString('da-DK')}, fik kr ${Number(d.received).toLocaleString('da-DK')} for ${d.shareSold} % — ${p.investors.join(', ')}.`
    : `Pitchede i Løvens Hule S${d.season} uden aftale.`)
    + (p.events.length ? ' Se efterliv, kilder og kapitalhistorik.' : ' Se kapitalhistorik og kilder.');
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: co.name, url: HOST + sti,
      ...(co.cvr_nummer ? { identifier: { '@type': 'PropertyValue', propertyID: 'CVR', value: co.cvr_nummer } } : {}) },
    { '@context': 'https://schema.org', ...brodkrumme(co.name, sti) },
  ];
  skriv(sti.slice(1), side({ sti, titel: `${co.name} — Løvens Hule S${d.season} | Hulens Data`, beskrivelse, jsonld, krop }));
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
  const beskrivelse = `${m.name} i Løvens Hule: ${m.deals} deals, kr ${Number(m.received).toLocaleString('da-DK')} investeret, sæson ${m.panelSeasons.join(', ')}. Se alle investeringer, partnere og mønstre.`;
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Person', name: m.name, url: HOST + sti, jobTitle: 'Investor, Løvens Hule (DR)' },
    { '@context': 'https://schema.org', ...brodkrumme(m.name, sti) },
  ];
  skriv(sti.slice(1), side({ sti, titel: `${m.name} — investeringer i Løvens Hule | Hulens Data`, beskrivelse, jsonld, krop }));
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
  ctx.__rows = sd;
  const tabel = kald('__rows.map(renderLatestDealRow).join("")');
  const krop = `
<a class="back-btn" href="/">← Arkivet</a>
<h1 class="page-title">Løvens Hule sæson ${n} <span>·</span> ${s.year}</h1>
<div class="kpi-grid">
${kald(`renderKpiTile('Pitches', '${sd.length}', 'sæson ${n}')`)}
${kald(`renderKpiTile('Deals', '${lukket.length}', 'deal-rate ${sd.length ? Math.round(lukket.length / sd.length * 100) : 0}%')`)}
${kald(`renderKpiTile('Investeret', 'kr ${(sum / 1e6).toFixed(1).replace('.', ',')}M', '${s.year}')`)}
</div>
<div class="profile-panel">
  <div class="panel-label">Panelet i sæson ${n}</div>
  <div class="partner-chips">${panel.map(p => `<a class="partner-chip" href="/loever/${p.slug}/">${esc(p.canonical_name)}${p.role === 'gaest' ? ' <span class="chip-count">gæst</span>' : ''}</a>`).join('')}</div>
</div>
<div class="profile-panel">
  <div class="panel-label">Alle ${sd.length} pitches</div>
  <table class="latest-deals-table"><thead><tr><th>Virksomhed</th><th>Afsnit</th><th>Modtaget</th><th>Investorer</th></tr></thead><tbody>${tabel}</tbody></table>
</div>`;
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'TVSeason', name: `Løvens Hule sæson ${n}`, seasonNumber: n,
      partOfSeries: { '@type': 'TVSeries', name: 'Løvens Hule' }, url: HOST + sti },
    { '@context': 'https://schema.org', ...brodkrumme(`Sæson ${n}`, sti) },
  ];
  skriv(sti.slice(1), side({ sti, titel: `Løvens Hule sæson ${n} (${s.year}): alle deals og investeringer | Hulens Data`,
    beskrivelse: `Sæson ${n} af Løvens Hule (${s.year}): ${sd.length} pitches, ${lukket.length} deals, kr ${(sum / 1e6).toFixed(1).replace('.', ',')} mio. investeret. Panelet, alle virksomheder og beløb.`, jsonld, krop }));
  stier.push(sti);
}
console.log(`saesoner: ${arkiv.seasons.length} bind`);

/* ── 7. Sitemap ── */
const faste = ['/', '/deals.html', '/companies.html', '/investors.html', '/charts.html'];
writeFileSync(join(ROD, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  [...faste, ...stier].map(u => `  <url><loc>${HOST}${u}</loc><lastmod>${TRYKT}</lastmod></url>`).join('\n') +
  `\n</urlset>\n`);
console.log(`sitemap: ${faste.length + stier.length} URL'er · trykt ${TRYKT}`);
