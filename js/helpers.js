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

// Kompakt beløbsformat til nøgletal: kr 450k / kr 2.0M
const fmtShort = n => n == null ? '—' : n >= 1000000 ? `kr ${(n/1000000).toFixed(1)}M` : `kr ${(n/1000).toFixed(0)}k`;

// Formatér procent
const pct = n => n == null ? '—' : n + '%';

// URL'er til profilerne = de statisk trykte bind (/virksomheder/, /loever/).
// Navne-param kun som fallback hvis slug mangler (bør ikke ske).
function companyUrl(name) {
  const slug = COMPANY_SLUGS[name];
  return slug ? '/virksomheder/' + encodeURIComponent(slug) + '/'
              : 'companies.html?name=' + encodeURIComponent(name);
}
function investorUrl(name) {
  const st = INVESTOR_STATUS[name];
  return st && st.slug ? '/loever/' + encodeURIComponent(st.slug) + '/'
                       : 'investors.html?name=' + encodeURIComponent(name);
}

// Kilder for en entitet (fodnoter) — tom liste hvis arkivlaget ikke er loadet
function sourcesFor(entityType, entityId) {
  return (typeof SOURCES !== 'undefined' && SOURCES[entityType + ':' + entityId]) || [];
}

// Journalnummer ("Sag № 022") og bind (sæson som romertal) — kartotekets mærker
function sagsNr(name) {
  const id = typeof COMPANY_IDS !== 'undefined' ? COMPANY_IDS[name] : null;
  return id ? String(id).padStart(3, '0') : null;
}
function romertal(n) {
  const t = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let r = '';
  for (const [v, s] of t) while (n >= v) { r += s; n -= v; }
  return r;
}

// Arkivdato med præcisionsærlighed: "2018" ≠ "17.04.2018"
function fmtEventDate(isoDate, precision) {
  const [y, m, d] = isoDate.split('-');
  if (precision === 'day') return `${d}.${m}.${y}`;
  if (precision === 'month') return `${m}.${y}`;
  return y;
}

// Byg investor-indeks: aggregater udledes af deals-data (observerbar sandhed),
// status/panel-sæsoner kommer fra investor_status-viewet (redaktionel sandhed,
// udfyldt i INVESTOR_STATUS af loadDeals). Intet er hardcodet.
// Returnerer { investors: [...], latestSeason }
function buildInvestorIndex(deals) {
  const latestSeason = Math.max(...deals.map(d => d.season));
  const map = {};
  deals.forEach(d => {
    d.investorList.forEach(inv => {
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
    const st = INVESTOR_STATUS[m.name];
    m.status = st ? st.status : 'tidligere';
    m.panelSeasons = st && st.panel_seasons ? st.panel_seasons : [...m.seasons].sort((a, b) => a - b);
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
    const others = d.investorList.filter(i => i !== m.name);
    if (others.length === 0) solo++;
    others.forEach(p => partnerCounts[p] = (partnerCounts[p] || 0) + 1);
  });
  const partners = Object.entries(partnerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return { m, dealList, medianDeal, partners, solo, shared: dealList.length - solo };
}

// Profildata for én virksomhed — kapitalhistorik, investornetværk og sæsonkontekst
function buildCompanyProfile(name, allDeals) {
  const dealList = allDeals.filter(d => d.name === name);
  if (dealList.length === 0) return null;

  const latest = dealList[dealList.length - 1];
  const totalReceived = dealList.reduce((s, d) => s + (d.received || 0), 0);
  const totalAsked = dealList.reduce((s, d) => s + (d.asked || 0), 0);
  const totalShareSold = dealList.reduce((s, d) => s + (d.shareSold || 0), 0) || null;
  const lastValAfter = [...dealList].reverse().find(d => d.valAfter)?.valAfter || null;
  const investors = [...new Set(dealList.flatMap(d => d.investorList))];
  const seasonSpan = [...new Set(dealList.map(d => 'S' + d.season))].join(' · ');

  // Relaterede virksomheder = deler investorer (ecosystem-loop).
  // Vægt = antal fælles investorer på tværs af deals.
  const relatedCounts = {};
  if (investors.length) {
    allDeals.forEach(d => {
      if (d.name === name) return;
      const overlap = d.investorList.filter(i => investors.includes(i)).length;
      if (overlap) relatedCounts[d.name] = (relatedCounts[d.name] || 0) + overlap;
    });
  }
  const related = Object.entries(relatedCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([n, count]) => ({ name: n, count }));

  // Sæsonkontekst pr. deal: placering blandt sæsonens deals + sæsonmedian
  const seasonContext = dealList.map(d => {
    if (!d.received) return null;
    const sd = allDeals.filter(x => x.season === d.season && x.received).sort((a, b) => b.received - a.received);
    const vals = sd.map(x => x.received).sort((a, b) => a - b);
    const mid = vals.length / 2;
    return {
      rank: sd.indexOf(d) + 1,
      total: sd.length,
      median: vals.length % 2 ? vals[Math.floor(mid)] : (vals[mid - 1] + vals[mid]) / 2,
    };
  });

  // Arkivlaget: efterlivs-events (med kilder) + stempel + revisionsdato.
  // Events bor i COMPANY_EVENTS (loadCompanyArchive) — tom liste hvis ikke loadet.
  const slug = typeof COMPANY_SLUGS !== 'undefined' ? COMPANY_SLUGS[name] : null;
  const events = ((typeof COMPANY_EVENTS !== 'undefined' && COMPANY_EVENTS[slug]) || [])
    .map(e => ({ ...e, sources: sourcesFor('company_event', e.id) }));
  const STAMP_TYPES = { bankruptcy: 'Konkurs', closed: 'Lukket', exit: 'Exit', cancelled: 'Deal kollapset' };
  const stampEvent = [...events].reverse().find(e => STAMP_TYPES[e.event_type]);
  const stamp = stampEvent
    ? { text: STAMP_TYPES[stampEvent.event_type], gold: stampEvent.event_type === 'exit' }
    : null;
  const revised = events.length
    ? events.map(e => e.updated_at).sort().pop().slice(0, 10)
    : null;

  return { name, dealList, latest, totalReceived, totalAsked, totalShareSold, lastValAfter, investors, seasonSpan, related, seasonContext, events, stamp, revised };
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
    investors: new Set(deals.flatMap(d => d.investorList)).size,
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
