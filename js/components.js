/* ═══════════════════════════════════════════════════════════════
   js/components.js — genbrugelige render-funktioner

   Kontrakt: en komponent modtager FÆRDIGE data, returnerer en
   HTML-streng og ændrer aldrig data. Al DB-tekst escapes med esc().
   Events wires af siden via event-delegation (data-attributter).
   ═══════════════════════════════════════════════════════════════ */

// Deal-række (deals-tabellen) — returnerer <tr>-markup for ét deal.
// Virksomhedsnavne er ægte links til de trykte bind (crawlbar intern graf).
function renderDealRow(d) {
  const change = (d.valBefore && d.valAfter) ? d.valAfter - d.valBefore : null;
  return `
    <tr>
      <td><a class="company-name" href="${companyUrl(d.name)}">${esc(d.name)}</a></td>
      <td><span class="season-badge">S${d.season}${d.episode ? `E` + d.episode : ``}</span></td>
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
// KARTEIEN: kortet står på højkant i skuffen — hvilende ses kun kanten
// (№, navn, spænd, statusmærke); hover/fokus løfter kortet op og viser
// forsiden. Hele kortet er ét link til det trykte bind.
function renderCompanyCard(name, deals) {
  const latest = deals[deals.length - 1];
  const hasDeal = deals.some(d => d.received);
  const totalReceived = deals.reduce((s, d) => s + (d.received || 0), 0);
  const investors = [...new Set(deals.flatMap(d => d.investorList))];
  const statusRaw = (latest.status || '').toLowerCase();
  const nr = sagsNr(name);
  return `
    <a class="kartei-kort" href="${companyUrl(name)}" data-name="${esc(name)}" aria-label="${esc(name)} — træk sagen frem">
      <span class="kk-kant">
        <span class="kk-nr num">${nr ? '№ ' + nr : '—'}</span>
        <span class="kk-navn">${esc(name)}</span>
        <span class="kk-spaend num">${[...new Set(deals.map(d => 'S' + d.season))].join('·')}</span>
        <span class="kk-maerke ${esc(statusRaw) || 'ukendt'}${hasDeal ? '' : ' ingen'}" title="${hasDeal ? 'aftale i hulen' : 'ingen aftale'}"></span>
      </span>
      <span class="kk-front">
        <span class="kk-linje">${hasDeal
          ? `Aftale <b class="num">${fmt(totalReceived)}</b> — ${esc(investors.join(', '))}`
          : 'Pitchede uden aftale'}</span>
        <span class="kk-linje dim">${latest.category ? esc(latest.category) + ' · ' : ''}${deals.map(d => `S${d.season}${d.episode ? `E` + d.episode : ``}`).join(', ')} · Bind ${romertal(deals[0].season)}</span>
        <span class="kk-traek">træk sagen frem →</span>
      </span>
    </a>`;
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
  const seasons = m.panelSeasons;
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
    `<a class="partner-chip" href="${investorUrl(pt.name)}">${esc(pt.name)} <span class="chip-count">${pt.count}</span></a>`
  ).join('') || '<span class="profile-dim">Ingen co-investeringer</span>';

  return `
    <div class="mappe">
    <div class="mappe-fane"><span class="num">PERSONAKT</span> ${esc(m.name)} <span class="mf-bind num">${span}</span></div>
    <div class="mappe-indhold">
    <div class="profile-hero dokument">
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
    </div>
    </div>
    </div>`;
}

// Virksomheds-profil — mini-dashboard (hero + kapitalhistorik + netværk).
// p er output fra buildCompanyProfile(); chips håndteres af siden via
/* ── Arkivet: efterlivs-tidslinje, fodnoter, stempel (generiske komponenter) ── */

const EVENT_TYPE_LABELS = {
  renegotiated: 'Genforhandlet', cancelled: 'Samarbejde ophørt',
  follow_on_investment: 'Opfølgende investering', exit: 'Exit',
  bankruptcy: 'Konkurs', closed: 'Lukket', comeback: 'Comeback',
  rebrand: 'Rebranding', funding_round: 'Fundingrunde',
  milestone: 'Milepæl', other: 'Hændelse',
};

// SourceFootnote: kildeliste under et tidslinje-punkt. Kun http(s)-links
// rendres som links (håndhæves også af DB-constraint); noten ligger i title.
function renderSourceList(sources) {
  if (!sources.length) return '';
  const items = sources.map(s => {
    const label = esc(s.source_name) + (s.confidence === 'uncertain' ? ' (usikker)' : '');
    const t = s.note ? ` title="${esc(s.note)}"` : '';
    return s.source_url && /^https?:\/\//i.test(s.source_url)
      ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener"${t}>${label}</a>`
      : `<span${t}>${label}</span>`;
  }).join(' · ');
  return `<div class="ae-sources">Kilde${sources.length === 1 ? '' : 'r'}: ${items}</div>`;
}

// EventItem: ét efterlivs-punkt — dato (med præcisionsærlighed), type, titel,
// beskrivelse (hændelser, ikke narrativer — se decisions), kilder
function renderArchiveEvent(e) {
  return `
    <div class="funding-step archive-event">
      <div class="fs-marker ae-marker${e.event_type === 'exit' ? ' deal' : ''}"></div>
      <div class="fs-head">
        <span class="ae-date num">${fmtEventDate(e.event_date, e.date_precision)}</span>
        <span class="fs-outcome${e.event_type === 'exit' ? ' deal' : ''}">${EVENT_TYPE_LABELS[e.event_type] || 'Hændelse'}</span>
      </div>
      <div class="fs-row">${esc(e.title)}</div>
      ${e.description ? `<div class="ae-desc">${esc(e.description)}</div>` : ''}
      ${renderSourceList(e.sources)}
    </div>`;
}

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
          <span class="season-badge">S${d.season}${d.episode ? `E` + d.episode : ``}</span>
          ${d.received
            ? '<span class="fs-outcome deal">Deal ✓</span>'
            : '<span class="fs-outcome">Ingen aftale</span>'}
          ${valDelta != null ? `<span class="num fs-delta ${valDelta >= 0 ? 'val-up' : 'val-down'}">${valDelta >= 0 ? '▲' : '▼'} ${Math.abs(valDelta)}% val.</span>` : ''}
        </div>
        <div class="fs-row">Søgte <span class="num">${fmt(d.asked)}</span> for <span class="num">${pct(d.shareOffered)}</span>${d.valBefore ? ` · val. <span class="num">${fmt(d.valBefore)}</span>` : ''}</div>
        ${d.received ? `<div class="fs-row">Fik <span class="num gold">${fmt(d.received)}</span> for <span class="num">${pct(d.shareSold)}</span>${d.valAfter ? ` · val. <span class="num">${fmt(d.valAfter)}</span>` : ''}</div>` : ''}
        ${ctx ? `<div class="fs-ctx">#${ctx.rank} af ${ctx.total} deals i S${d.season} · sæsonmedian ${fmtShort(ctx.median)}</div>` : ''}
        ${renderSourceList(sourcesFor('deal', d.id))}
      </div>`;
  }).join('');

  // Efterlivet: tidslinjen fortsætter efter TV-øjeblikket ("kameraerne slukker")
  const aftermath = p.events.length ? `
      <div class="aftermath-divider"><span>— kameraerne slukker · <b>efterlivet</b> —</span></div>
      ${p.events.map(renderArchiveEvent).join('')}` : '';

  const revisionInfo = p.revised
    ? `<div class="archive-revision">Sagen revideret ${p.revised.split('-').reverse().join('.')}</div>` : '';

  const investorChips = p.investors.map(n =>
    `<a class="partner-chip" href="${investorUrl(n)}">${esc(n)}</a>`).join('')
    || '<span class="profile-dim">Ingen investorer — fik ikke en aftale</span>';

  const relatedChips = p.related.map(r =>
    `<a class="partner-chip related-chip" href="${companyUrl(r.name)}">${esc(r.name)} <span class="chip-count">${r.count}</span></a>`).join('')
    || '<span class="profile-dim">Ingen fælles investorer med andre virksomheder</span>';

  return `
    <div class="mappe">
    <div class="mappe-fane"><span class="num">${sagsNr(p.name) ? 'SAG № ' + sagsNr(p.name) : 'SAG'}</span> ${esc(p.name)} <span class="mf-bind num">BIND ${romertal(p.dealList[0].season)}</span></div>
    <div class="mappe-indhold">
    <div class="profile-hero dokument">
      <div class="inv-topline">
        <span class="co-status-line">
          <span class="co-status-dot ${esc(statusRaw) || 'ukendt'}"></span>
          <span class="inv-badge">${p.latest.status ? esc(p.latest.status[0].toUpperCase() + p.latest.status.slice(1)) : 'Ukendt status'}</span>
          ${p.latest.category ? `<span class="co-badge">${esc(p.latest.category)}</span>` : ''}
        </span>
        <span class="inv-span">${p.seasonSpan}</span>
      </div>
      ${p.stamp ? `<span class="status-stamp${p.stamp.gold ? ' gold' : ''}">${esc(p.stamp.text)}</span>` : ''}
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
        <div class="panel-label">Kapitalhistorik${p.events.length ? ' & efterliv' : ''}</div>
        <div class="funding-timeline">${steps}${aftermath}</div>
        ${revisionInfo}
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
    </div>
    </div>
    </div>`;
}

/* ── Forside-dashboard (A+) ── */

// KPI-tile: stort nøgletal i guld + mono-undertekst
function renderKpiTile(label, value, sub) {
  return `
    <div class="kpi">
      <div class="k">${esc(label)}</div>
      <div class="v">${esc(value)}</div>
      <div class="s num">${esc(sub)}</div>
    </div>`;
}

// Kompakt deal-række til "Seneste deals"-panelet (4 kolonner)
function renderLatestDealRow(d) {
  return `
    <tr>
      <td class="co"><a class="company-name" href="${companyUrl(d.name)}">${esc(d.name)}</a></td>
      <td><span class="ep num">S${d.season}${d.episode ? `E` + d.episode : ``}</span></td>
      <td class="amt num">${fmt(d.received)}</td>
      <td class="inv">${esc(d.investorList.join(', '))}</td>
    </tr>`;
}

// Højdepunkts-række (label + stort tal + kontekst)
function renderStoryRow(label, value, context, deltaHtml) {
  return `
    <div class="story">
      <div class="k">${esc(label)}</div>
      <div class="v">${esc(value)}${deltaHtml || ''}</div>
      <div class="c">${esc(context)}</div>
    </div>`;
}

// Aktiv løve-række: navn + proportional guld-bar + deals·beløb (mono)
function renderLionRow(m, maxDeals) {
  const w = Math.max(10, Math.round(m.latestSeasonDeals / maxDeals * 96));
  return `
    <div class="lion" data-name="${esc(m.name)}" tabindex="0" role="link" aria-label="${esc(m.name)} — åbn profil">
      <span class="dot"></span>
      <span class="n">${esc(m.name)}</span>
      <span class="bar" style="width:${w}px"></span>
      <span class="d num">${m.latestSeasonDeals} · ${(m.latestSeasonReceived/1000000).toFixed(1)}M</span>
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

  // Spænd-chippen viser PANEL-sæsoner (hvornår de sad i hulen), ikke kun deal-sæsoner
  const seasons = m.panelSeasons;
  const span = seasons.length === 1
    ? `S${seasons[0]}`
    : `S${seasons[0]}–S${seasons[seasons.length - 1]}`;

  const heroLabel  = isActive ? `Sæson ${latestSeason}` : 'Karriere i hulen';
  const heroDeals  = isActive ? m.latestSeasonDeals : m.deals;
  const heroAmount = isActive ? m.latestSeasonReceived : m.received;

  return `
    <a class="kartei-kort kartei-kort--person${isActive ? ' er-aktiv' : ''}" href="${investorUrl(m.name)}" data-name="${esc(m.name)}" aria-label="${esc(m.name)} — træk personakten frem">
      <span class="kk-kant">
        <span class="kk-nr num">${span}</span>
        <span class="kk-navn">${esc(m.name)}</span>
        <span class="kk-spaend num">${heroDeals} deal${heroDeals === 1 ? '' : 's'} · kr ${(heroAmount/1000000).toFixed(1).replace('.', ',')}M</span>
        <span class="kk-maerke ${isActive ? 'aktiv' : m.status === 'gaest' ? 'ukendt' : 'inaktiv'}" title="${isActive ? 'aktiv løve' : m.status === 'gaest' ? 'gæsteløve' : 'tidligere løve'}"></span>
      </span>
      <span class="kk-front">
        <span class="kk-linje">${m.deals} deals i alt · <b class="num">kr ${(m.received/1000000).toFixed(1).replace('.', ',')}M</b> investeret${m.avgShare ? ` · gns. andel ${m.avgShare.toFixed(1).replace('.', ',')} %` : ''}</span>
        ${m.largest ? `<span class="kk-linje dim">Største aftale: ${esc(m.largest.name)} (kr ${(m.largest.received/1000000).toFixed(1).replace('.', ',')}M)</span>` : ''}
        <span class="kk-traek">træk personakten frem →</span>
      </span>
    </a>`;
}
