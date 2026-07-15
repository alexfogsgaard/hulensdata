/* Fælles header, navigation og statisk søgning. */

const NAV_PAGES = [
  { id: 'companies', href: '/companies.html', label: 'Virksomheder' },
  { id: 'deals', href: '/deals.html', label: 'Pitches & aftaler' },
  { id: 'investors', href: '/investors.html', label: 'Investorer' },
  { id: 'seasons', href: '/#saesoner', label: 'Sæsoner' },
  { id: 'archive', href: '/arkiv/', label: 'Arkiv' },
  { id: 'charts', href: '/charts.html', label: 'Analyser' },
];

const layoutEsc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function renderSiteHeader(activePage) {
  const host = document.querySelector('.site-header');
  if (!host) return;

  if (!document.querySelector('.skip-link')) {
    host.insertAdjacentHTML('beforebegin', '<a class="skip-link" href="#main-content">Spring til indhold</a>');
  }

  host.innerHTML = `
    <div class="header-bar">
      <a class="wordmark" href="/" aria-label="Hulens Data, forside">
        <span class="wordmark-name">Hulens Data</span>
        <span class="wordmark-description">Uofficielt dataarkiv</span>
      </a>
      <div class="header-tools">
        <div class="global-search site-search" role="search" data-search>
          <label class="sr-only" for="global-search-input">Søg i arkivet</label>
          <input id="global-search-input" type="search" placeholder="Søg virksomhed eller investor" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="global-search-results" aria-expanded="false">
          <span class="search-shortcut" aria-hidden="true">⌘K</span>
          <div class="search-results" id="global-search-results" role="listbox" hidden></div>
        </div>
        <div class="header-stats" id="header-stats" aria-live="polite"></div>
      </div>
    </div>
    <nav class="site-nav" aria-label="Primær navigation">
      ${NAV_PAGES.map(page =>
        `<a href="${page.href}"${page.id === activePage ? ' class="active" aria-current="page"' : ''}>${page.label}</a>`
      ).join('')}
    </nav>`;

  initArchiveSearch(host.querySelector('[data-search]'));
}

let SEARCH_INDEX = null;

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('da-DK');
}

async function ensureSearchIndex() {
  if (SEARCH_INDEX) return SEARCH_INDEX;
  const [investors, companies] = await Promise.all([
    sbFetch('investor_status?select=canonical_name,slug,status&order=canonical_name.asc'),
    sbFetch('companies?select=name,slug,status,category&order=name.asc'),
  ]);
  SEARCH_INDEX = [
    ...companies.map(company => ({
      type: 'Virksomhed',
      name: company.name,
      detail: company.category || 'Kategori ikke dokumenteret',
      url: company.slug ? `/virksomheder/${encodeURIComponent(company.slug)}/` : `/companies.html?name=${encodeURIComponent(company.name)}`,
    })),
    ...investors.map(investor => ({
      type: 'Investor',
      name: investor.canonical_name,
      detail: investor.status === 'aktiv' ? 'Aktiv investor' : investor.status === 'gaest' ? 'Gæsteinvestor' : 'Tidligere investor',
      url: investor.slug ? `/loever/${encodeURIComponent(investor.slug)}/` : `/investors.html?name=${encodeURIComponent(investor.canonical_name)}`,
    })),
  ].map(item => ({ ...item, searchName: normalizeSearch(item.name) }));
  return SEARCH_INDEX;
}

function initArchiveSearch(root) {
  if (!root || root.dataset.searchReady === 'true') return;
  root.dataset.searchReady = 'true';
  const input = root.querySelector('input[type="search"], input[type="text"]');
  const results = root.querySelector('.search-results');
  if (!input || !results) return;

  let hits = [];
  let activeIndex = -1;

  const close = () => {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const paint = () => {
    if (!hits.length) {
      results.innerHTML = '<div class="search-empty">Ingen resultater. Prøv et andet navn.</div>';
    } else {
      results.innerHTML = hits.map((hit, index) => `
        <a id="search-option-${input.id}-${index}" class="search-result${index === activeIndex ? ' active' : ''}" href="${layoutEsc(hit.url)}" role="option" aria-selected="${index === activeIndex}">
          <span><strong>${layoutEsc(hit.name)}</strong><small>${layoutEsc(hit.detail)}</small></span>
          <span class="search-result-type">${hit.type}</span>
        </a>`).join('');
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `search-option-${input.id}-${activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const update = async () => {
    const query = normalizeSearch(input.value.trim());
    if (query.length < 2) {
      hits = [];
      close();
      return;
    }
    try {
      const index = await ensureSearchIndex();
      hits = index
        .filter(item => item.searchName.includes(query))
        .sort((a, b) => {
          const aStarts = a.searchName.startsWith(query) ? 0 : 1;
          const bStarts = b.searchName.startsWith(query) ? 0 : 1;
          return aStarts - bStarts || a.name.localeCompare(b.name, 'da');
        })
        .slice(0, 8);
      activeIndex = -1;
      paint();
    } catch (error) {
      console.error('Søgeindekset kunne ikke indlæses:', error);
      results.innerHTML = '<div class="search-empty">Søgningen kunne ikke indlæses. Prøv igen.</div>';
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', () => {
    ensureSearchIndex().catch(() => {});
    if (input.value.trim().length >= 2) update();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
      input.blur();
      return;
    }
    if (results.hidden || !hits.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, hits.length - 1);
      paint();
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      paint();
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      window.location.assign(hits[activeIndex].url);
    }
  });
  input.addEventListener('blur', () => window.setTimeout(close, 150));
}

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase('da-DK') === 'k') {
    const input = document.getElementById('global-search-input');
    if (!input) return;
    event.preventDefault();
    input.focus();
    input.select();
  }
});
