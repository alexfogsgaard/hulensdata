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

// Virksomhedskort (companies-gridet) — deals er virksomhedens deals, kronologisk.
// Kompakt: status + navn + badges. Hover/fokus: deal-tal, investorer, afsnit.
function renderCompanyCard(name, deals) {
  const latest = deals[deals.length - 1];
  const hasDeal = deals.some(d => d.received);
  const totalReceived = deals.reduce((s, d) => s + (d.received || 0), 0);
  const investors = [...new Set(deals.flatMap(d => d.investorList).filter(i => i !== 'Alle investorer'))];
  const statusRaw = (latest.status || '').toLowerCase();
  return `
    <div class="co-card" data-name="${esc(name)}" tabindex="0" role="link" aria-label="${esc(name)} — åbn virksomhed">
      <div class="co-card-top">
        <div class="co-status-dot ${esc(statusRaw) || 'ukendt'}"></div>
        <div class="co-name">${esc(name)}</div>
      </div>
      <div class="co-meta">
        <span class="co-badge">${[...new Set(deals.map(d => 'S' + d.season))].join(', ')}</span>
        ${hasDeal ? '<span class="co-badge gold">Deal ✓</span>' : ''}
        ${latest.category ? `<span class="co-badge">${esc(latest.category)}</span>` : ''}
      </div>
      <div class="co-details">
        <div class="co-details-inner">
          <div class="co-detail-row"><span class="k">${hasDeal ? 'Modtaget' : 'Søgte'}</span><span class="v num${hasDeal ? ' gold' : ''}">${fmt(hasDeal ? totalReceived : latest.asked)}</span></div>
          ${investors.length ? `<div class="co-detail-row"><span class="k">Investor${investors.length > 1 ? 'er' : ''}</span><span class="v">${esc(investors.slice(0, 2).join(', '))}${investors.length > 2 ? ' +' + (investors.length - 2) : ''}</span></div>` : ''}
          <div class="co-detail-row"><span class="k">Afsnit</span><span class="v">${deals.map(d => `S${d.season}E${d.episode}`).join(', ')}</span></div>
          <div class="co-cta">Se virksomhed →</div>
        </div>
      </div>
    </div>`;
}

// Investor-profil — mini-dashboard (hero + sæsongraf + mønstre + deals-tabel).
// p er output fra buildInvestorProfile(); klik på partnere/virksomheder
// håndteres af siden via delegation (data-name / data-company).
function renderInvestorProfile(p, latestSeason) {
  const m = p.m;
  const isActive = m.status === 'aktiv';
  const badge = isActive
    ? '<span class="inv-badge inv-badge--active">● Aktiv løve</span>'
    : m.status === 'gaest' ? '<span class="inv-badge">Gæsteløve</span>' : '<span class="inv-badge">Tidligere løve</span>';
  const seasons = [...m.seasons].sort((a, b) => a - b);
  const span = seasons.length === 1 ? `S${seasons[0]}` : `S${seasons[0]}–S${seasons[seasons.length - 1]}`;

  // Sæsongraf: investeret pr. sæson (kun investorens egne tal)
  const maxV = Math.max(...Object.values(m.bySeason).map(b => b.received), 1);
  let bars = '';
  for (let s = 1; s <= latestSeason; s++) {
    const b = m.bySeason[s];
    const mio = b ? (b.received / 1000000).toFixed(1) : null;
    bars += `
      <div class="strip-col" title="${b ? `S${s}: ${b.deals} deal${b.deals === 1 ? '' : 's'} · kr ${mio} mio.` : `S${s}: ikke aktiv`}">
        <div class="strip-fill${s === latestSeason && b ? ' latest' : ''}${b ? '' : ' inactive'}" style="height:${b ? Math.max(6, Math.round(b.received / maxV * 100)) : 3}%"></div>
        <span class="${s === latestSeason && b ? 'latest' : ''}">S${s}</span>
      </div>`;
  }

  const partnerChips = p.partners.slice(0, 4).map(pt =>
    `<button class="partner-chip" data-name="${esc(pt.name)}">${esc(pt.name)} <span class="chip-count">${pt.count}</span></button>`
  ).join('') || '<span class="profile-dim">Ingen co-investeringer</span>';

  return `
    <div class="profile-hero">
      <div class="inv-topline">${badge}<span class="inv-span">${span}</span></div>
      <h1 class="profile-name">${esc(m.name)}</h1>
      <div class="profile-metrics">
        <div class="pm"><span class="k">Deals</span><span class="v num">${m.deals}</span></div>
        <div class="pm"><span class="k">Samlet investeret</span><span class="v num">kr ${(m.received/1000000).toFixed(1)}M</span></div>
        <div class="pm"><span class="k">Gns. andel</span><span class="v num">${m.avgShare ? m.avgShare.toFixed(1) + '%' : '—'}</span></div>
        <div class="pm"><span class="k">Typisk deal</span><span class="v num">${p.medianDeal ? 'kr ' + (p.medianDeal/1000).toFixed(0) + 'k' : '—'}</span></div>
        <div class="pm"><span class="k">Største deal</span><span class="v num">${m.largest ? 'kr ' + (m.largest.received/1000000).toFixed(1) + 'M' : '—'}</span></div>
      </div>
    </div>

    <div class="profile-grid">
      <div class="profile-panel">
        <div class="panel-label">Investeret pr. sæson</div>
        <div class="strip-bars profile-strip">${bars}</div>
      </div>
      <div class="profile-panel">
        <div class="panel-label">Mønstre</div>
        <div class="pattern-row"><span class="k">Største deal</span><span class="v">${m.largest ? `<span class="company-name" data-company="${esc(m.largest.name)}">${esc(m.largest.name)}</span> · kr ${(m.largest.received/1000000).toFixed(1)}M` : '—'}</span></div>
        <div class="pattern-row"><span class="k">Solo / sammen</span><span class="v num">${p.solo} / ${p.shared}</span></div>
        <div class="pattern-row pattern-partners"><span class="k">Hyppigste partnere</span></div>
        <div class="partner-chips">${partnerChips}</div>
      </div>
    </div>

    <div class="profile-panel profile-table">
      <div class="panel-label">Alle deals (${p.dealList.length})</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Virksomhed</th>
              <th>Sæson</th>
              <th class="num">Søger</th>
              <th class="num col-secondary">Tilbudt andel</th>
              <th class="num col-secondary">Val. før</th>
              <th class="num">Modtaget</th>
              <th class="num col-secondary">Solgt andel</th>
              <th class="num col-secondary">Val. efter</th>
              <th class="num col-secondary">Ændring</th>
              <th>Investorer</th>
            </tr>
          </thead>
          <tbody>${p.dealList.map(renderDealRow).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// Virksomheds-profil — mini-dashboard (hero + kapitalhistorik + netværk).
// p er output fra buildCompanyProfile(); chips håndteres af siden via
// delegation: .related-chip → anden virksomhed, .partner-chip → investorprofil.
function renderCompanyProfile(p) {
  const statusRaw = (p.latest.status || '').toLowerCase();
  const hasDeal = p.totalReceived > 0;

  // Kapitalhistorik: ét trin pr. optræden i hulen
  const steps = p.dealList.map((d, i) => {
    const ctx = p.seasonContext[i];
    const valDelta = (d.valBefore && d.valAfter)
      ? Math.round((d.valAfter - d.valBefore) / d.valBefore * 100)
      : null;
    return `
      <div class="funding-step">
        <div class="fs-marker${d.received ? ' deal' : ''}"></div>
        <div class="fs-head">
          <span class="season-badge">S${d.season}E${d.episode}</span>
          ${d.received
            ? '<span class="fs-outcome deal">Deal ✓</span>'
            : '<span class="fs-outcome">Ingen aftale</span>'}
          ${valDelta != null ? `<span class="num fs-delta ${valDelta >= 0 ? 'val-up' : 'val-down'}">${valDelta >= 0 ? '▲' : '▼'} ${Math.abs(valDelta)}% val.</span>` : ''}
        </div>
        <div class="fs-row">Søgte <span class="num">${fmt(d.asked)}</span> for <span class="num">${pct(d.shareOffered)}</span>${d.valBefore ? ` · val. <span class="num">${fmt(d.valBefore)}</span>` : ''}</div>
        ${d.received ? `<div class="fs-row">Fik <span class="num gold">${fmt(d.received)}</span> for <span class="num">${pct(d.shareSold)}</span>${d.valAfter ? ` · val. <span class="num">${fmt(d.valAfter)}</span>` : ''}</div>` : ''}
        ${ctx ? `<div class="fs-ctx">#${ctx.rank} af ${ctx.total} deals i S${d.season} · sæsonmedian ${fmtShort(ctx.median)}</div>` : ''}
      </div>`;
  }).join('');

  const investorChips = p.investors.map(n =>
    `<button class="partner-chip" data-name="${esc(n)}">${esc(n)}</button>`).join('')
    || '<span class="profile-dim">Ingen investorer — fik ikke en aftale</span>';

  const relatedChips = p.related.map(r =>
    `<button class="partner-chip related-chip" data-name="${esc(r.name)}">${esc(r.name)} <span class="chip-count">${r.count}</span></button>`).join('')
    || '<span class="profile-dim">Ingen fælles investorer med andre virksomheder</span>';

  return `
    <div class="profile-hero">
      <div class="inv-topline">
        <span class="co-status-line">
          <span class="co-status-dot ${esc(statusRaw) || 'ukendt'}"></span>
          <span class="inv-badge">${esc(p.latest.status) || 'Ukendt status'}</span>
          ${p.latest.category ? `<span class="co-badge">${esc(p.latest.category)}</span>` : ''}
        </span>
        <span class="inv-span">${p.seasonSpan}</span>
      </div>
      <h1 class="profile-name">${esc(p.name)}</h1>
      <div class="profile-metrics">
        <div class="pm"><span class="k">Modtaget</span><span class="v num">${hasDeal ? fmtShort(p.totalReceived) : '—'}</span></div>
        <div class="pm"><span class="k">Søgte</span><span class="v num">${fmtShort(p.totalAsked)}</span></div>
        <div class="pm"><span class="k">Solgt andel</span><span class="v num">${hasDeal && p.totalShareSold ? p.totalShareSold + '%' : '—'}</span></div>
        <div class="pm"><span class="k">Seneste valuation</span><span class="v num">${p.lastValAfter ? fmtShort(p.lastValAfter) : '—'}</span></div>
        <div class="pm"><span class="k">Pitches</span><span class="v num">${p.dealList.length}</span></div>
      </div>
    </div>

    <div class="profile-grid">
      <div class="profile-panel">
        <div class="panel-label">Kapitalhistorik</div>
        <div class="funding-timeline">${steps}</div>
      </div>
      <div class="profile-stack">
        <div class="profile-panel">
          <div class="panel-label">Investor${p.investors.length === 1 ? '' : 'er'} (${p.investors.length})</div>
          <div class="partner-chips">${investorChips}</div>
        </div>
        <div class="profile-panel">
          <div class="panel-label">Relaterede virksomheder · samme investorer</div>
          <div class="partner-chips">${relatedChips}</div>
        </div>
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
