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
      <td class="num">${fmt(d.asked)}</td>
      <td class="num dim col-secondary">${pct(d.shareOffered)}</td>
      <td class="num dim col-secondary">${fmt(d.valBefore)}</td>
      <td class="num${d.received ? ' received' : ''}">${fmt(d.received)}</td>
      <td class="num dim col-secondary">${pct(d.shareSold)}</td>
      <td class="num dim col-secondary">${fmt(d.valAfter)}</td>
      <td class="num col-secondary ${change == null ? '' : change >= 0 ? 'val-up' : 'val-down'}">${change == null ? '—' : (change >= 0 ? '+' : '') + fmt(change)}</td>
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

// Skeleton-placeholders — vises mens data hentes (styles i style.css §SKELETON)
function renderSkeletonCards(count) {
  return Array.from({ length: count }, () => '<div class="skeleton skeleton-card"></div>').join('');
}
function renderSkeletonRows(count, cols) {
  return Array.from({ length: count }, () =>
    `<tr class="skeleton-row"><td colspan="${cols}"><div class="skeleton skeleton-line"></div></td></tr>`).join('');
}

// Sparkline: deals pr. sæson som mini-søjler (inline SVG — ingen Chart.js pr. kort)
function renderSeasonSparkline(m, latestSeason) {
  const max = Math.max(...Object.values(m.bySeason).map(b => b.deals));
  const W = 6, GAP = 3, H = 28;
  let bars = '';
  for (let s = 1; s <= latestSeason; s++) {
    const b = m.bySeason[s];
    const h = b ? Math.max(4, Math.round(b.deals / max * (H - 2))) : 2;
    bars += `<rect x="${(s - 1) * (W + GAP)}" y="${H - h}" width="${W}" height="${h}" rx="1" class="${b ? 'spark-on' : 'spark-off'}"><title>S${s}: ${b ? b.deals + ' deal' + (b.deals === 1 ? '' : 's') : 'ingen deals'}</title></rect>`;
  }
  const width = latestSeason * (W + GAP) - GAP;
  return `<svg class="inv-spark" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img" aria-label="Deals pr. sæson">${bars}</svg>`;
}

// Investorkort v2 — kompakt primærvisning (seneste sæson for aktive løver),
// dybere data folder ud ved hover/focus. Klik/Enter åbner fuld profil.
// m er et element fra buildInvestorIndex().investors.
function renderInvestorCard(m, latestSeason) {
  const isActive = m.status === 'aktiv';

  const badge = isActive
    ? '<span class="inv-badge inv-badge--active">● Aktiv løve</span>'
    : m.status === 'gaest'
      ? '<span class="inv-badge">Gæsteløve</span>'
      : '<span class="inv-badge">Tidligere løve</span>';

  const seasons = [...m.seasons].sort((a, b) => a - b);
  const span = seasons.length === 1
    ? `S${seasons[0]}`
    : `S${seasons[0]}–S${seasons[seasons.length - 1]}`;

  const heroLabel  = isActive ? `Sæson ${latestSeason}` : 'Karriere i hulen';
  const heroDeals  = isActive ? m.latestSeasonDeals : m.deals;
  const heroAmount = isActive ? m.latestSeasonReceived : m.received;

  return `
    <div class="investor-card${isActive ? ' investor-card--active' : ''}" data-name="${esc(m.name)}" tabindex="0" role="link" aria-label="${esc(m.name)} — åbn fuld profil">
      <div class="inv-topline">${badge}<span class="inv-span">${span}</span></div>
      <div class="inv-name">${esc(m.name)}</div>
      <div class="inv-hero">
        <div class="inv-hero-label">${heroLabel}</div>
        <div class="inv-hero-value">${heroDeals} deal${heroDeals === 1 ? '' : 's'} · kr ${(heroAmount/1000000).toFixed(1)}M</div>
      </div>
      <div class="inv-details">
        <div class="inv-details-inner">
          <div class="inv-mini-grid">
            <div class="inv-mini"><span class="k">Deals i alt</span><span class="v">${m.deals}</span></div>
            <div class="inv-mini"><span class="k">Samlet investeret</span><span class="v">kr ${(m.received/1000000).toFixed(1)}M</span></div>
            <div class="inv-mini"><span class="k">Gns. andel</span><span class="v">${m.avgShare ? m.avgShare.toFixed(1) + '%' : '—'}</span></div>
            <div class="inv-mini"><span class="k">Største deal</span><span class="v">${m.largest ? 'kr ' + (m.largest.received/1000000).toFixed(1) + 'M' : '—'}</span></div>
          </div>
          ${m.largest ? `<div class="inv-largest">Største deal: ${esc(m.largest.name)}</div>` : ''}
          <div class="inv-spark-row">
            <span class="inv-spark-label">Deals pr. sæson</span>
            ${renderSeasonSparkline(m, latestSeason)}
          </div>
          <div class="inv-cta">Se fuld profil →</div>
        </div>
      </div>
    </div>`;
}
