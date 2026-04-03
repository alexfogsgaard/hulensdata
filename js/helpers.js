/* ═══════════════════════════════════════════════════════════════
   js/helpers.js — Delte hjælpefunktioner brugt på tværs af sider
   ═══════════════════════════════════════════════════════════════ */

// Formatér tal til dansk valuta
const fmt = n => n == null ? '—' : 'kr ' + n.toLocaleString('da-DK');

// Formatér procent
const pct = n => n == null ? '—' : n + '%';

// Kanoniske navne — normaliserer stavevarianter
const NAME_CANON = {
  'birgith aaby':          'Birgit Aaby',
  'birgit aaby':           'Birgit Aaby',
  'ilse jackobsen':        'Ilse Jacobsen',
  'ilse jacobsen':         'Ilse Jacobsen',
  'jakob risgaard':        'Jacob Risgaard',
  'jacob risgaard':        'Jacob Risgaard',
  'christian ahrnstedt':   'Christian Arnstedt',
  'christian arhnstedt':   'Christian Arnstedt',
  'christian arnstedt':    'Christian Arnstedt',
  'nicolai nyholm':        'Nikolaj Nyholm',
  'nikolaj nyholm':        'Nikolaj Nyholm',
  'louise herping':        'Louise Herping Ellegaard',
  'louise herping ellegaard': 'Louise Herping Ellegaard',
  'anne stampe':           'Anne Stampe Olesen',
  'anne stampe olesen':    'Anne Stampe Olesen',
  'tahir':                 'Tahir Siddique',
  'tahir siddique':        'Tahir Siddique',
  'morten larsen':         'Morten Larsen',
  'jesper buch':           'Jesper Buch',
  'christian stadil':      'Christian Stadil',
  'tommy ahlers':          'Tommy Ahlers',
  'jan lehrmann':          'Jan Lehrmann',
  'mia wagner':            'Mia Wagner',
  'peter warnøe':          'Peter Warnøe',
  'thomas visti':          'Thomas Visti',
  'rasmus kolbe':          'Rasmus Kolbe',
};

function canonName(name) {
  return NAME_CANON[name.toLowerCase().trim()] || name.trim();
}

// Parse investor-streng til array af kanoniske navne
function parseInvestors(str) {
  if (!str) return [];
  const parts = str
    .replace(/og /gi, ', ')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

  const result = [];
  parts.forEach(name => {
    const lc = name.toLowerCase().trim();
    if (lc.includes('alle')) { result.push('Alle investorer'); return; }
    result.push(canonName(name));
  });
  return [...new Set(result)];
}

// Aktive løver (nuværende panel)
const ACTIVE_LIONS = new Set([
  'Jesper Buch',
  'Birgit Aaby',
  'Nikolaj Nyholm',
  'Tahir Siddique',
  'Anne Stampe Olesen',
  'Lis Beck',
  'Louise Herping Ellegaard',
  'Morten Larsen',
  'Christian Stadil',
  'Thomas Visti',
  'Rasmus Kolbe',
]);

// Gennemsnit af array (ignorerer null)
function avg(arr) {
  const valid = arr.filter(x => x != null && isFinite(x));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// Render header stats på en side
function renderHeaderStats(deals) {
  const el = document.getElementById('header-stats');
  if (!el) return;

  const totalReceived = deals.filter(d => d.received).reduce((s, d) => s + d.received, 0);
  const seasons = new Set(deals.map(d => d.season)).size;
  const investors = new Set(deals.flatMap(d => d.investorList).filter(i => i !== 'Alle investorer')).size;

  el.innerHTML = [
    { val: deals.length,                                     lbl: 'Deals' },
    { val: seasons,                                          lbl: 'Sæsoner' },
    { val: investors,                                        lbl: 'Investorer' },
    { val: 'kr ' + (totalReceived / 1000000).toFixed(1) + 'M', lbl: 'Samlet investeret' },
  ].map(s => `
    <div class="stat-pill">
      <div class="val">${s.val}</div>
      <div class="lbl">${s.lbl}</div>
    </div>
  `).join('');
}

// Highlight aktiv nav-link baseret på nuværende side
function setActiveNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === 'index.html' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
}
