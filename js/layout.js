/* Fælles header, navigation og statisk søgning. */

const NAV_PAGES = [
  { id: 'companies', href: '/companies.html', label: 'Virksomheder' },
  { id: 'deals', href: '/deals.html', label: 'Pitches & aftaler' },
  { id: 'investors', href: '/investors.html', label: 'Investorer' },
  { id: 'seasons', href: '/#saesoner', label: 'Sæsoner' },
  { id: 'archive', href: '/arkiv/', label: 'Arkiv' },
  { id: 'charts', href: '/charts.html', label: 'Analyser' },
  { id: 'method', href: '/metode/', label: 'Metode' },
];

const layoutEsc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function renderSiteHeader(activePage, statsText = '') {
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
          <input id="global-search-input" type="search" placeholder="Søg i arkivet" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="global-search-results" aria-expanded="false">
          <span class="search-shortcut" aria-hidden="true">⌘K</span>
          <div class="search-results" id="global-search-results" role="listbox" hidden></div>
        </div>
        <div class="header-stats" id="header-stats" aria-live="polite">${layoutEsc(statsText)}</div>
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
    .toLocaleLowerCase('da-DK')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function ensureSearchIndex() {
  if (SEARCH_INDEX) return SEARCH_INDEX;
  try {
    const response = await fetch('/data/search-index.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Søgeindeks svarede med status ${response.status}`);
    const payload = await response.json();
    SEARCH_INDEX = payload.items;
  } catch (error) {
    // Hvis det lille indeks mangler, bruges stadig den statiske publikation.
    // Global søgning etablerer aldrig selv en direkte Supabase-afhængighed.
    const response = await fetch('/data/arkiv.json', { cache: 'no-cache' });
    if (!response.ok) throw error;
    const archive = await response.json();
    const investors = archive.investor_status || [];
    const companies = archive.companies || [];
    SEARCH_INDEX = [
      ...companies.map(company => ({
        group: 'Virksomheder', type: 'Virksomhed', name: company.name,
        detail: company.category || 'Kategori ikke dokumenteret',
        url: company.slug ? `/virksomheder/${encodeURIComponent(company.slug)}/` : `/companies.html?name=${encodeURIComponent(company.name)}`,
        keywords: [company.name, company.category, company.cvr_nummer].filter(Boolean),
      })),
      ...investors.map(investor => ({
        group: 'Investorer', type: 'Investor', name: investor.canonical_name,
        detail: investor.status === 'aktiv' ? 'Aktiv investor' : investor.status === 'gaest' ? 'Gæsteinvestor' : 'Tidligere investor',
        url: investor.slug ? `/loever/${encodeURIComponent(investor.slug)}/` : `/investors.html?name=${encodeURIComponent(investor.canonical_name)}`,
        keywords: [investor.canonical_name, investor.status],
      })),
    ];
  }
  SEARCH_INDEX = SEARCH_INDEX.map(item => {
    const searchName = normalizeSearch(item.name);
    const searchWords = normalizeSearch([item.name, item.detail, ...(item.keywords || [])].join(' ')).split(' ').filter(Boolean);
    return { ...item, searchName, searchWords: [...new Set(searchWords)] };
  });
  return SEARCH_INDEX;
}

function searchScore(item, query) {
  if (item.searchName === query) return 0;
  if (item.searchName.startsWith(query)) return 1;
  if (item.searchName.split(' ').some(word => word.startsWith(query))) return 2;
  const terms = query.split(' ').filter(Boolean);
  if (terms.length && terms.every(term => item.searchWords.some(word => word.startsWith(term)))) return 3;
  if (query.length >= 4 && item.searchName.includes(query)) return 4;
  return null;
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
      results.setAttribute('role', 'status');
      results.innerHTML = '<div class="search-empty">Ingen resultater. Prøv et navn, CVR, en sæson, kategori eller hændelse.</div>';
    } else {
      results.setAttribute('role', 'listbox');
      const groups = [];
      hits.forEach((hit, index) => {
        const name = hit.group || hit.type;
        let group = groups[groups.length - 1];
        if (!group || group.name !== name) {
          group = { name, entries: [] };
          groups.push(group);
        }
        group.entries.push({ hit, index });
      });
      results.innerHTML = groups.map((group, groupIndex) => {
        const groupId = `search-group-${input.id}-${groupIndex}`;
        return `<div class="search-result-group" role="group" aria-labelledby="${groupId}">
          <div class="search-group" id="${groupId}">${layoutEsc(group.name)}</div>
          ${group.entries.map(({ hit, index }) => `
          <a id="search-option-${input.id}-${index}" class="search-result${index === activeIndex ? ' active' : ''}" href="${layoutEsc(hit.url)}" role="option" tabindex="-1" aria-selected="${index === activeIndex}">
            <span><strong>${layoutEsc(hit.name)}</strong><small>${layoutEsc(hit.detail)}</small></span>
            <span class="search-result-type">${hit.type}</span>
          </a>`).join('')}
        </div>`;
      }).join('');
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
        .map(item => ({ ...item, score: searchScore(item, query) }))
        .filter(item => item.score != null)
        .sort((a, b) => a.score - b.score || String(a.group).localeCompare(String(b.group), 'da') || a.name.localeCompare(b.name, 'da'))
        .slice(0, 12)
        .sort((a, b) => {
          const groups = ['Virksomheder', 'Investorer', 'Sæsoner', 'Kategorier', 'Registre', 'Dokumenterede hændelser', 'Metode'];
          return groups.indexOf(a.group) - groups.indexOf(b.group) || a.score - b.score || a.name.localeCompare(b.name, 'da');
        });
      activeIndex = -1;
      paint();
    } catch (error) {
      console.error('Søgeindekset kunne ikke indlæses:', error);
      results.setAttribute('role', 'status');
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
    if (event.key === 'Home') {
      event.preventDefault();
      activeIndex = 0;
      paint();
    }
    if (event.key === 'End') {
      event.preventDefault();
      activeIndex = hits.length - 1;
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
