/* ═══════════════════════════════════════════════════════════════
   js/components.js — genbrugelige render-funktioner

   Kontrakt: en komponent modtager FÆRDIGE data, returnerer en
   HTML-streng og ændrer aldrig data. Al DB-tekst escapes med esc().
   Events wires af siden via event-delegation (data-attributter).
   ═══════════════════════════════════════════════════════════════ */

// Investorkort — m er et element fra buildInvestorIndex().investors
function renderInvestorCard(m, latestSeason) {
  const isActive = m.status === 'aktiv';

  const badge = isActive
    ? '<div class="active-lion-badge">● Aktiv løve</div>'
    : m.status === 'gaest' ? '<div class="active-lion-badge guest">Gæsteløve</div>' : '';

  const latestRow = isActive
    ? `<div class="inv-stat"><span class="k">Sæson ${latestSeason}</span><span class="v">${m.latestSeasonDeals} deal${m.latestSeasonDeals === 1 ? '' : 's'} · kr ${(m.latestSeasonReceived/1000000).toFixed(1)}M</span></div>`
    : '';

  return `
    <div class="investor-card${isActive ? ' investor-card--active' : ''}" data-name="${esc(m.name)}">
      ${badge}
      <div class="inv-name">${esc(m.name)}</div>
      ${latestRow}
      <div class="inv-stat"><span class="k">Antal deals</span><span class="v">${m.deals}</span></div>
      <div class="inv-stat"><span class="k">Sæsoner aktiv</span><span class="v">${[...m.seasons].sort((a,b) => a-b).map(s => 'S'+s).join(', ')}</span></div>
      <div class="inv-stat"><span class="k">Gns. andel solgt</span><span class="v">${m.avgShare ? m.avgShare.toFixed(1)+'%' : '—'}</span></div>
      <div class="inv-stat"><span class="k">Samlet investeret</span><span class="v">kr ${(m.received/1000000).toFixed(1)}M</span></div>
    </div>`;
}
