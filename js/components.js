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
      <td><span class="season-badge">S${d.season}${d.episode == null ? '' : ` · Afsnit ${d.episode}`}</span></td>
      <td class="num${d.asked == null ? ' unknown' : ''}">${d.asked == null ? 'Ikke dokumenteret' : fmt(d.asked)}</td>
      <td class="num dim col-secondary${d.shareOffered == null ? ' unknown' : ''}">${d.shareOffered == null ? 'Ikke dokumenteret' : pct(d.shareOffered)}</td>
      <td class="num dim col-secondary${d.valBefore == null ? ' unknown' : ''}">${d.valBefore == null ? 'Ikke dokumenteret' : fmt(d.valBefore)}</td>
      <td class="num${d.received ? ' received' : ''}">${d.aftale ? knownMoney(d.received) : 'Ingen aftale'}</td>
      <td class="num dim col-secondary${d.shareSold == null ? ' unknown' : ''}">${d.aftale ? knownPercent(d.shareSold) : 'Ikke relevant'}</td>
      <td class="num dim col-secondary${d.valAfter == null ? ' unknown' : ''}">${d.aftale && d.valAfter != null ? fmt(d.valAfter) : d.aftale ? 'Ikke dokumenteret' : 'Ikke relevant'}</td>
      <td class="num col-secondary ${change == null ? 'unknown' : change >= 0 ? 'val-up' : 'val-down'}">${change == null ? 'Ikke dokumenteret' : (change >= 0 ? '+' : '') + fmt(change)}</td>
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
  const company = typeof COMPANIES !== 'undefined' ? COMPANIES[name] : null;
  return `
    <a class="entity-card" href="${companyUrl(name)}">
      <span class="entity-card-main">
        <span class="entity-card-kicker">${esc(latest.category || 'Kategori ikke dokumenteret')}</span>
        <strong>${esc(name)}</strong>
        <span class="entity-card-summary">${hasDeal
          ? `${fmt(totalReceived)} på TV · ${esc(investors.join(', '))}`
          : 'Pitchede uden aftale'}</span>
      </span>
      <span class="entity-card-meta">
        <span>${deals.map(d => `S${d.season}${d.episode == null ? '' : ` · Afsnit ${d.episode}`}`).join(' / ')}</span>
        <span class="status-label status-${esc(statusRaw) || 'ukendt'}">${latest.status ? esc(latest.status) : 'Ukendt status'}</span>
        <span>${company && company.cvr_nummer ? `CVR ${esc(company.cvr_nummer)}` : 'CVR ikke dokumenteret'}</span>
      </span>
      <span class="entity-card-action" aria-hidden="true">Se virksomhed →</span>
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
  milestone: 'Milepæl', other: 'Ejerskifte eller anden hændelse',
};

// SourceFootnote: kildeliste under et tidslinje-punkt. Kun http(s)-links
// rendres som links (håndhæves også af DB-constraint); noten ligger i title.
function renderSourceList(sources) {
  if (!sources.length) return '';
  const items = sources.map(s => {
    const confidence = s.confidence === 'uncertain' ? 'Usikker kilde' : s.confidence === 'likely' ? 'Sandsynlig' : 'Bekræftet';
    const sourceName = s.source_url && /^https?:\/\//i.test(s.source_url)
      ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener">${esc(s.source_name)}</a>`
      : `<span>${esc(s.source_name)}</span>`;
    return `<li>${sourceName}<span class="source-confidence confidence-${esc(s.confidence || 'confirmed')}">${confidence}</span>${s.note ? `<span class="source-note">${esc(s.note)}</span>` : ''}</li>`;
  }).join('');
  return `<div class="source-list"><span class="source-list-label">Kilde${sources.length === 1 ? '' : 'r'}</span><ul>${items}</ul></div>`;
}

// EventItem: ét efterlivs-punkt — dato (med præcisionsærlighed), type, titel,
// beskrivelse (hændelser, ikke narrativer — se decisions), kilder
function renderArchiveEvent(e) {
  return `
    <article class="timeline-entry archive-event" data-event-type="${esc(e.event_type)}">
      <div class="timeline-meta">
        <time class="num" datetime="${esc(e.event_date)}">${fmtEventDate(e.event_date, e.date_precision)}</time>
        <span class="event-type">${EVENT_TYPE_LABELS[e.event_type] || 'Hændelse'}</span>
      </div>
      <h3>${esc(e.title)}</h3>
      ${e.description ? `<p>${esc(e.description)}</p>` : ''}
      ${renderSourceList(e.sources)}
    </article>`;
}

// delegation: .related-chip → anden virksomhed, .partner-chip → investorprofil.
function renderCompanyProfile(p) {
  const company = p.company || {};
  const status = company.status || p.latest.status || 'ukendt';
  const statusLabel = status === 'aktiv' ? 'Aktiv' : status === 'inaktiv' ? 'Inaktiv' : 'Ukendt status';

  const appearances = p.dealList.map((deal, index) => {
    const context = p.seasonContext[index];
    const investors = deal.investorList.length
      ? deal.investorList.map(name => `<a href="${investorUrl(name)}">${esc(name)}</a>`).join(', ')
      : 'Ingen investorer — ingen aftale dokumenteret';
    return `
      <article class="tv-appearance">
        <header>
          <span class="section-kicker">${episodeLabel(deal)}</span>
          <span class="deal-outcome ${deal.aftale ? 'has-deal' : 'no-deal'}">${deal.aftale ? 'Aftale på TV' : 'Ingen aftale på TV'}</span>
        </header>
        <dl class="fact-grid fact-grid-tv">
          <div><dt>Søgte</dt><dd class="num${deal.asked == null ? ' unknown' : ''}">${knownMoney(deal.asked)}</dd></div>
          <div><dt>Tilbudt andel</dt><dd class="num${deal.shareOffered == null ? ' unknown' : ''}">${knownPercent(deal.shareOffered)}</dd></div>
          <div><dt>Resultat på TV</dt><dd>${deal.aftale ? `${knownMoney(deal.received)} for ${knownPercent(deal.shareSold)}` : 'Ingen aftale dokumenteret'}</dd></div>
          <div><dt>Investorer</dt><dd>${investors}</dd></div>
        </dl>
        ${context ? `<p class="context-note">Aftalen var nr. ${context.rank} af ${context.total} i sæsonen målt på TV-beløb. Sæsonmedian: ${fmt(context.median)}.</p>` : ''}
        ${renderSourceList(sourcesFor('deal', deal.id))}
      </article>`;
  }).join('');

  const investorLinks = p.investors.length
    ? p.investors.map(name => `<a class="text-link" href="${investorUrl(name)}">${esc(name)}</a>`).join('')
    : '<span class="empty-value">Ingen investorer — ingen aftale dokumenteret</span>';
  const relatedLinks = p.related.length
    ? p.related.map(item => `<a class="text-link" href="${companyUrl(item.name)}">${esc(item.name)}</a>`).join('')
    : '<span class="empty-value">Ingen relaterede virksomheder via fælles investorer</span>';
  const registerNames = { exits: 'Exits', konkurser: 'Konkurser og lukninger', 'kollapsede-deals': 'Kollapsede deals' };
  const registerLinks = p.registers.length
    ? p.registers.map(slug => `<a class="text-link" href="/arkiv/${slug}/">${registerNames[slug]}</a>`).join('')
    : '<span class="empty-value">Ingen tematiske registre knyttet til sagen</span>';

  return `
    <article class="company-profile">
      <header class="company-profile-header">
        <div class="profile-eyebrow">Virksomhed fra Løvens Hule · ${esc(p.seasonSpan)}</div>
        <h1>${esc(p.name)}</h1>
        <p>TV-pitch, dokumenteret aftale og virksomhedens efterliv holdes adskilt, så det er tydeligt, hvad kilderne faktisk viser.</p>
        <div class="profile-status-row">
          <span class="status-label status-${esc(status)}">${statusLabel}</span>
          <span>${esc(company.category || 'Kategori ikke dokumenteret')}</span>
          <span class="num">${company.cvr_nummer ? `CVR ${esc(company.cvr_nummer)}` : 'CVR ikke dokumenteret'}</span>
        </div>
        ${p.revised ? `<p class="revision-note">Senest revideret ${p.revised.split('-').reverse().join('.')} · ${p.allSources.length} kilder knyttet til sagen</p>` : `<p class="revision-note">Ingen efterlivsrevision dokumenteret · ${p.allSources.length} kilder knyttet til sagen</p>`}
      </header>

      <nav class="profile-nav" aria-label="På denne side">
        <a href="#identitet">Identitet</a>
        <a href="#tv-forloeb">Pitch og TV-aftale</a>
        <a href="#efterliv">Efterliv</a>
        <a href="#kilder">Kilder og relationer</a>
      </nav>

      <section class="profile-section" id="identitet">
        <div class="section-heading"><span class="section-kicker">01 · Identitet</span><h2>Virksomheden</h2></div>
        <dl class="fact-grid">
          <div><dt>Navn</dt><dd>${esc(p.name)}</dd></div>
          <div><dt>Status</dt><dd>${statusLabel}</dd></div>
          <div><dt>Kategori</dt><dd class="${company.category ? '' : 'unknown'}">${esc(company.category || 'Ikke dokumenteret')}</dd></div>
          <div><dt>CVR</dt><dd class="num ${company.cvr_nummer ? '' : 'unknown'}">${esc(company.cvr_nummer || 'Ikke dokumenteret')}</dd></div>
          <div><dt>Optrædener</dt><dd class="num">${p.dealList.length}</dd></div>
          <div><dt>Dokumenterede efterlivshændelser</dt><dd class="num">${p.events.length}</dd></div>
        </dl>
        ${renderSourceList(p.companySources)}
      </section>

      <section class="profile-section" id="tv-forloeb">
        <div class="section-heading"><span class="section-kicker">02 · TV-forløb</span><h2>Pitch og aftale</h2><p>Vilkår fra udsendelsen. Senere ændringer vises først under efterliv.</p></div>
        <div class="tv-appearances">${appearances}</div>
      </section>

      <section class="profile-section" id="efterliv">
        <div class="section-heading"><span class="section-kicker">03 · Efter kameraerne</span><h2>Dokumenteret efterliv</h2><p>Kun daterede hændelser med synlige kilder.</p></div>
        <div class="timeline">${p.events.length
          ? p.events.map(renderArchiveEvent).join('')
          : '<div class="empty-state"><strong>Intet efterliv er dokumenteret endnu.</strong><span>Det betyder ikke, at der ikke er sket noget — kun at arkivet ikke har en tilstrækkelig kilde.</span></div>'}
        </div>
      </section>

      <section class="profile-section" id="kilder">
        <div class="section-heading"><span class="section-kicker">04 · Dokumentation</span><h2>Kilder og relationer</h2></div>
        <div class="documentation-grid">
          <div><h3>Alle kilder i sagen</h3>${p.allSources.length ? renderSourceList(p.allSources) : '<p class="empty-value">Ingen særskilte kilder er knyttet til sagen endnu.</p>'}</div>
          <div class="relation-groups">
            <div><h3>Investorer</h3><div class="text-links">${investorLinks}</div></div>
            <div><h3>Relaterede virksomheder</h3><div class="text-links">${relatedLinks}</div></div>
            <div><h3>Registre</h3><div class="text-links">${registerLinks}</div></div>
          </div>
        </div>
      </section>
    </article>`;
}

function renderHomepageEvent(event, company) {
  const sources = event.sources || [];
  return `
    <article class="story-card">
      <div class="story-card-meta"><span>${EVENT_TYPE_LABELS[event.event_type] || 'Hændelse'}</span><time class="num" datetime="${esc(event.event_date)}">${fmtEventDate(event.event_date, event.date_precision)}</time></div>
      <h3><a href="${companyUrl(company.name)}">${esc(company.name)}</a></h3>
      <p>${esc(event.title)}</p>
      <div class="story-card-source">${sources.length} ${sources.length === 1 ? 'kilde' : 'kilder'} · <a href="${companyUrl(company.name)}#efterliv">Se dokumentationen</a></div>
    </article>`;
}

function renderEditorialStat(label, value, note) {
  return `<div class="editorial-stat"><dt>${esc(label)}</dt><dd class="num">${esc(value)}</dd><span>${esc(note)}</span></div>`;
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
