/* ═══════════════════════════════════════════════════════════════
   js/layout.js — fælles layout-elementer (header/nav + global søgning)
   ═══════════════════════════════════════════════════════════════ */

const NAV_PAGES = [
  { id: 'deals',     href: 'deals.html',     label: 'Deals' },
  { id: 'investors', href: 'investors.html', label: 'Investorer' },
  { id: 'companies', href: 'companies.html', label: 'Virksomheder' },
  { id: 'charts',    href: 'charts.html',    label: 'Grafer' },
];

// Udfylder <header class="site-header"> med wordmark, nav, global søgning
// og stats-container. Kaldes synkront i et <script> lige efter header-
// elementet — ingen FOUC. #header-stats udfyldes bagefter af renderHeaderStats().
function renderSiteHeader(activePage) {
  const host = document.querySelector('.site-header');
  if (!host) return;
  host.innerHTML = `
    <a class="wordmark" href="index.html">Hulens <span>Data</span></a>
    <nav class="site-nav">
      ${NAV_PAGES.map(p =>
        `<a href="${p.href}"${p.id === activePage ? ' class="active"' : ''}>${p.label}</a>`
      ).join('\n      ')}
    </nav>
    <div class="global-search">
      <input id="global-search-input" type="text" placeholder="Søg virksomhed eller løve…" autocomplete="off" spellcheck="false" aria-label="Global søgning">
      <span class="kbd">⌘K</span>
      <div class="search-results" id="search-results" hidden></div>
    </div>
    <div class="header-stats" id="header-stats"></div>
  `;
  initGlobalSearch();
}

/* ── Global søgning (⌘K) — søger på tværs af løver og virksomheder.
     Indekset hentes lazy fra de normaliserede tabeller (første fokus). ── */
let SEARCH_INDEX = null;
let searchActiveIdx = -1;

async function ensureSearchIndex() {
  if (SEARCH_INDEX) return SEARCH_INDEX;
  const [invs, cos] = await Promise.all([
    sbFetch('investor_status?select=canonical_name,status&order=canonical_name.asc'),
    sbFetch('companies?select=name,slug&order=name.asc'),
  ]);
  SEARCH_INDEX = [
    ...invs.map(i => ({ type: 'Løve', name: i.canonical_name, url: 'investors.html?name=' + encodeURIComponent(i.canonical_name) })),
    ...cos.map(c => ({ type: 'Virksomhed', name: c.name, url: c.slug ? 'companies.html?co=' + encodeURIComponent(c.slug) : 'companies.html?name=' + encodeURIComponent(c.name) })),
  ];
  return SEARCH_INDEX;
}

function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const box = document.getElementById('search-results');
  if (!input || !box) return;

  const hide = () => { box.hidden = true; searchActiveIdx = -1; };

  const renderResults = hits => {
    if (!hits.length) { box.innerHTML = '<div class="sr-empty">Ingen resultater</div>'; box.hidden = false; return; }
    box.innerHTML = hits.map((h, i) =>
      `<a class="sr-item${i === searchActiveIdx ? ' active' : ''}" href="${esc(h.url)}"><span class="sr-name">${esc(h.name)}</span><span class="sr-type">${h.type}</span></a>`
    ).join('');
    box.hidden = false;
  };

  let lastHits = [];
  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { hide(); return; }
    const idx = await ensureSearchIndex();
    searchActiveIdx = -1;
    lastHits = idx.filter(x => x.name.toLowerCase().includes(q)).slice(0, 8);
    renderResults(lastHits);
  });

  input.addEventListener('keydown', e => {
    if (box.hidden || !lastHits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); searchActiveIdx = Math.min(searchActiveIdx + 1, lastHits.length - 1); renderResults(lastHits); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); searchActiveIdx = Math.max(searchActiveIdx - 1, 0); renderResults(lastHits); }
    if (e.key === 'Enter' && searchActiveIdx >= 0) { e.preventDefault(); window.location = lastHits[searchActiveIdx].url; }
  });

  input.addEventListener('focus', () => ensureSearchIndex());
  input.addEventListener('blur', () => setTimeout(hide, 150)); // lad klik i dropdown nå frem

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    if (e.key === 'Escape') { hide(); input.blur(); }
  });
}
