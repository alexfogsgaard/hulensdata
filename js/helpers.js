/* ═══════════════════════════════════════════════════════════════
   js/helpers.js — Delte hjælpefunktioner brugt på tværs af sider
   ═══════════════════════════════════════════════════════════════ */

// Escape HTML-specialtegn — brug ved al interpolation af DB-data i innerHTML
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    // Ikke-navne må aldrig blive til investorer (fx gammel S5-7-konvention
    // hvor "Ingen aftale" stod i investor-feltet — jf. K2 i vaulten)
    if (lc === 'ingen aftale' || lc === 'ingen investor' || lc === 'ingen') return;
    if (lc.includes('alle')) { result.push('Alle investorer'); return; }
    result.push(canonName(name));
  });
  return [...new Set(result)];
}

// Gæsteløver — deltog enkelte afsnit uden at være fast panel-medlem.
// Kan ikke udledes af deals-data; flyttes til investors-tabellen i Supabase (Fase 3).
const GUEST_LIONS = new Set([
  'Thomas Visti',   // gæst i S9
  'Rasmus Kolbe',   // gæst i S10 (jubilæumssæsonen)
]);

// Byg investor-indeks fra deals-data — status udledes, ikke hardcodes:
//   aktiv     = har deal(s) i seneste sæson i datasættet
//   gaest     = på GUEST_LIONS-listen
//   tidligere = alle andre
// Returnerer { investors: [...], latestSeason }
function buildInvestorIndex(deals) {
  const latestSeason = Math.max(...deals.map(d => d.season));
  const map = {};
  deals.forEach(d => {
    d.investorList.forEach(inv => {
      if (inv === 'Alle investorer') return;
      if (!map[inv]) map[inv] = {
        name: inv, deals: 0, received: 0, seasons: new Set(),
        latestSeasonDeals: 0, latestSeasonReceived: 0, shares: [],
        bySeason: {}, largest: null,
      };
      const m = map[inv];
      m.deals++;
      m.received += d.received || 0;
      m.seasons.add(d.season);
      m.shares.push(d.shareSold);
      const bs = m.bySeason[d.season] || (m.bySeason[d.season] = { deals: 0, received: 0 });
      bs.deals++;
      bs.received += d.received || 0;
      if ((d.received || 0) > (m.largest ? m.largest.received : 0)) {
        m.largest = { name: d.name, received: d.received };
      }
      if (d.season === latestSeason) {
        m.latestSeasonDeals++;
        m.latestSeasonReceived += d.received || 0;
      }
    });
  });
  const investors = Object.values(map);
  investors.forEach(m => {
    m.avgShare = avg(m.shares);
    m.status = GUEST_LIONS.has(m.name) ? 'gaest'
             : m.seasons.has(latestSeason) ? 'aktiv'
             : 'tidligere';
  });
  return { investors, latestSeason };
}

// Gennemsnit af array (ignorerer null)
function avg(arr) {
  const valid = arr.filter(x => x != null && isFinite(x));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// Profildata for én investor — beriger et buildInvestorIndex-element med
// mønstre, der kun bruges på profilsiden (median, partnere, solo-andel)
function buildInvestorProfile(m, allDeals) {
  const dealList = allDeals.filter(d => d.investorList.includes(m.name));
  const received = dealList.map(d => d.received).filter(v => v).sort((a, b) => a - b);
  const mid = received.length / 2;
  const medianDeal = received.length
    ? (received.length % 2 ? received[Math.floor(mid)] : (received[mid - 1] + received[mid]) / 2)
    : null;

  const partnerCounts = {};
  let solo = 0;
  dealList.forEach(d => {
    const others = d.investorList.filter(i => i !== m.name && i !== 'Alle investorer');
    if (others.length === 0) solo++;
    others.forEach(p => partnerCounts[p] = (partnerCounts[p] || 0) + 1);
  });
  const partners = Object.entries(partnerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return { m, dealList, medianDeal, partners, solo, shared: dealList.length - solo };
}

// Globale nøgletal — beregnes ét sted; bruges af header-stats og forsiden
function getGlobalStats(deals) {
  const withDeal = deals.filter(d => d.received);
  return {
    deals: deals.length,                                       // alle pitches
    dealsClosed: withDeal.length,                              // gennemførte deals
    totalReceived: withDeal.reduce((s, d) => s + d.received, 0),
    seasons: new Set(deals.map(d => d.season)).size,
    latestSeason: Math.max(...deals.map(d => d.season)),
    investors: new Set(deals.flatMap(d => d.investorList).filter(i => i !== 'Alle investorer')).size,
  };
}

// Render header stats på en side
function renderHeaderStats(deals) {
  const el = document.getElementById('header-stats');
  if (!el) return;

  const s = getGlobalStats(deals);
  el.innerHTML = [
    { val: s.deals,                                             lbl: 'Deals' },
    { val: s.seasons,                                           lbl: 'Sæsoner' },
    { val: s.investors,                                         lbl: 'Investorer' },
    { val: 'kr ' + (s.totalReceived / 1000000).toFixed(1) + 'M', lbl: 'Samlet investeret' },
  ].map(p => `
    <div class="stat-pill">
      <div class="val">${p.val}</div>
      <div class="lbl">${p.lbl}</div>
    </div>
  `).join('');
}

// Vis synlig fejlbesked når data ikke kan hentes
function showLoadError() {
  const host = document.querySelector('.page-main') || document.body;
  const div = document.createElement('div');
  div.className = 'load-error';
  div.innerHTML = `<strong>Data kunne ikke hentes.</strong> Prøv at genindlæse siden — fortsætter problemet, er databasen midlertidigt utilgængelig.`;
  host.prepend(div);
}
