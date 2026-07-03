/* ═══════════════════════════════════════════════════════════════
   js/components.js — genbrugelige render-funktioner

   Kontrakt: en komponent modtager FÆRDIGE data, returnerer en
   HTML-streng og ændrer aldrig data. Al DB-tekst escapes med esc().
   Events wires af siden via event-delegation (data-attributter).
   ═══════════════════════════════════════════════════════════════ */

// Deal-række (deals-tabellen) — returnerer <tr>-markup for ét deal.
// Klik på virksomhedsnavn håndteres af siden via delegation på data-company.
function renderDealRow(d) {
  const change = (d.valBefore && d.valAfter) ? d.valAfter - d.valBefore : null;
  return `
    <tr>
      <td><span class="company-name" data-company="${esc(d.name)}">${esc(d.name)}</span></td>
      <td><span class="season-badge">S${d.season}E${d.episode}</span></td>
      <td>${fmt(d.asked)}</td>
      <td>${pct(d.shareOffered)}</td>
      <td>${fmt(d.valBefore)}</td>
      <td>${fmt(d.received)}</td>
      <td>${pct(d.shareSold)}</td>
      <td>${fmt(d.valAfter)}</td>
      <td class="${change == null ? '' : change >= 0 ? 'val-up' : 'val-down'}">${change == null ? '—' : (change >= 0 ? '+' : '') + fmt(change)}</td>
      <td class="investors-cell" title="${esc(d.investors)}">${esc(d.investorList.slice(0,2).join(', '))}${d.investorList.length > 2 ? ' +' + (d.investorList.length - 2) : ''}</td>
    </tr>`;
}

// Virksomhedskort (companies-gridet) — deals er virksomhedens deals, kronologisk
function renderCompanyCard(name, deals) {
  const latest = deals[deals.length - 1];
  const hasDeal = deals.some(d => d.received);
  const statusRaw = (latest.status || '').toLowerCase();
  return `
    <div class="co-card" data-name="${esc(name)}">
      <div class="co-card-top">
        <div class="co-status-dot ${esc(statusRaw) || 'ukendt'}"></div>
        <div class="co-name">${esc(name)}</div>
      </div>
      <div class="co-meta">
        <span class="co-badge">${[...new Set(deals.map(d => 'S' + d.season))].join(', ')}</span>
        ${hasDeal ? '<span class="co-badge gold">Deal ✓</span>' : ''}
        ${latest.category ? `<span class="co-badge">${esc(latest.category)}</span>` : ''}
      </div>
    </div>`;
}

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
