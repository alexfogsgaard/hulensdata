/* ═══════════════════════════════════════════════════════════════
   js/components.js — genbrugelige render-funktioner

   Kontrakt: en komponent modtager FÆRDIGE data, returnerer en
   HTML-streng og ændrer aldrig data. Al DB-tekst escapes med esc().
   Events wires af siden via event-delegation (data-attributter).
   ═══════════════════════════════════════════════════════════════ */

// Deal-række (deals-tabellen) — returnerer <tr>-markup for ét deal.
// Virksomhedsnavne er ægte links til de trykte bind (crawlbar intern graf).
function renderDealRow(d) {
  return `
    <tr>
      <td><a class="company-name" href="${companyUrl(d.name)}">${esc(d.name)}</a></td>
      <td><span class="season-badge">S${d.season}${d.episode == null ? '' : ` · Afsnit ${d.episode}`}</span></td>
      <td><span class="deal-outcome ${d.aftale ? 'has-deal' : 'no-deal'}">${d.aftale ? 'Aftale på TV' : 'Ingen aftale på TV'}</span></td>
      <td class="num${d.asked == null ? ' unknown' : ''}">${d.asked == null ? 'Ikke dokumenteret' : fmt(d.asked)}</td>
      <td class="num dim col-secondary${d.shareOffered == null ? ' unknown' : ''}">${d.shareOffered == null ? 'Ikke dokumenteret' : pct(d.shareOffered)}</td>
      <td class="num${d.received ? ' received' : ''}">${d.aftale ? knownMoney(d.received) : 'Ikke relevant'}</td>
      <td class="num dim col-secondary${d.shareSold == null ? ' unknown' : ''}">${d.aftale ? knownPercent(d.shareSold) : 'Ikke relevant'}</td>
      <td class="investors-cell" title="${esc(d.investors)}">${esc(d.investorList.slice(0,2).join(', '))}${d.investorList.length > 2 ? ' +' + (d.investorList.length - 2) : ''}</td>
      <td>${esc(d.category || 'Ikke dokumenteret')}</td>
      <td><span class="status-label status-${esc((d.status || 'ukendt').toLowerCase())}">${esc(d.status || 'Ukendt')}</span></td>
    </tr>`;
}

// Virksomhedskort i det redaktionelle register. Deals er kronologiske,
// og hele kortet er et direkte link til den statiske virksomhedsprofil.
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

// Investorprofil med panelhistorik, sæsonfordeling og registrerede TV-aftaler.
// P er output fra buildInvestorProfile(); relationer er direkte links.
function renderInvestorProfile(p, latestSeason) {
  const m = p.m;
  const statusLabel = m.status === 'aktiv' ? 'Aktiv investor' : m.status === 'gaest' ? 'Gæsteinvestor' : 'Tidligere investor';
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

  const partnerChips = p.partners.slice(0, 6).map(pt =>
    `<a class="text-link" href="${investorUrl(pt.name)}">${esc(pt.name)} · ${pt.count}</a>`
  ).join('') || '<span class="empty-value">Ingen fælles TV-aftaler registreret</span>';

  return `
    <article class="investor-profile company-profile">
      <header class="company-profile-header">
        <div class="profile-eyebrow">Investor i Løvens Hule · panelperiode ${span}</div>
        <h1>${esc(m.name)}</h1>
        <p>Profilen viser registrerede TV-aftaler og panelhistorik. Beløbene beskriver vilkårene i udsendelsen — ikke nødvendigvis den endelige investering.</p>
        <div class="profile-status-row"><span class="status-label status-${m.status === 'aktiv' ? 'aktiv' : 'ukendt'}">${statusLabel}</span><span>${span}</span><span class="num">${p.companyCount} virksomheder</span></div>
      </header>
      <nav class="profile-nav" aria-label="På denne side">
        <a href="#overblik">Overblik</a><a href="#saesoner">Sæsoner</a><a href="#aftaler">TV-aftaler</a><a href="#relationer">Relationer og metode</a>
      </nav>
      <section class="profile-section" id="overblik">
        <div class="section-heading"><span class="section-kicker">01 · Overblik</span><h2>Panelhistorik og registrerede aftaler</h2></div>
        <dl class="fact-grid">
          <div><dt>Panelperiode</dt><dd class="num">${span}</dd></div>
          <div><dt>Pitches i panelperiodens datasæt</dt><dd class="num">${p.panelPitchCount}</dd></div>
          <div><dt>Registrerede TV-aftaler</dt><dd class="num">${m.deals}</dd></div>
          <div><dt>Registreret TV-beløb</dt><dd class="num">${fmt(m.received)}</dd></div>
          <div><dt>Gennemsnitlig registreret andel</dt><dd class="num ${m.avgShare == null ? 'unknown' : ''}">${m.avgShare == null ? 'Ikke dokumenteret' : pct(Number(m.avgShare.toFixed(1)))}</dd></div>
          <div><dt>Typisk registreret TV-beløb</dt><dd class="num ${p.medianDeal == null ? 'unknown' : ''}">${knownMoney(p.medianDeal)}</dd></div>
        </dl>
        <p class="context-note">Pitchtallet er summen af registrerede pitches i investorens panelsæsoner. Datasættet viser ikke, hvilke enkelte pitches investoren personligt overværede, og sæson 1–4 har ufuldstændig pitchdækning.</p>
      </section>
      <section class="profile-section" id="saesoner">
        <div class="section-heading"><span class="section-kicker">02 · Sæsoner</span><h2>Registreret TV-beløb pr. sæson</h2><p>Søjler uden højde betyder, at der ikke er en aftale knyttet til investoren i sæsonen — ikke nødvendigvis at investoren var fraværende.</p></div>
        <div class="strip-bars profile-strip season-strip" aria-label="Registreret TV-beløb pr. sæson">${bars}</div>
      </section>
      <section class="profile-section" id="aftaler">
        <div class="section-heading"><span class="section-kicker">03 · TV-aftaler</span><h2>${p.dealList.length} registrerede aftaler</h2><p>Alle beløb og andele er de registrerede vilkår fra udsendelsen. Ukendte værdier markeres eksplicit.</p></div>
        <div class="table-wrap"><table><thead><tr><th>Virksomhed</th><th>Sæson</th><th>Udfald</th><th class="num">Søgte</th><th class="num">Tilbudt andel</th><th class="num">TV-beløb</th><th class="num">Andel i TV-aftale</th><th>Investorer</th><th>Kategori</th><th>Status</th></tr></thead><tbody>${p.dealList.map(renderDealRow).join('')}</tbody></table></div>
      </section>
      <section class="profile-section" id="relationer">
        <div class="section-heading"><span class="section-kicker">04 · Relationer og metode</span><h2>Medinvestorer og datagrænser</h2></div>
        <div class="documentation-grid"><div><h3>Hyppigste medinvestorer</h3><div class="text-links">${partnerChips}</div></div><div><h3>Datagrundlag</h3><p class="context-note">${p.solo} aftaler er registreret alene og ${p.shared} med andre investorer. ${p.knownAmountCount} af ${p.dealList.length} aftaler har et registreret TV-beløb; ${p.knownShareCount} har en registreret andel. Arkivet dokumenterer ikke automatisk, om aftalen blev gennemført efter optagelsen.</p></div></div>
      </section>
    </article>`;
}

// Virksomheds-profil — mini-dashboard (hero + kapitalhistorik + netværk).
// p er output fra buildCompanyProfile(); chips håndteres af siden via
/* ── Arkivet: efterlivs-tidslinje, fodnoter, stempel (generiske komponenter) ── */

const EVENT_TYPE_LABELS = {
  renegotiated: 'Genforhandlet', cancelled: 'Samarbejde ophørt',
  follow_on_investment: 'Opfølgende investering', exit: 'Exit',
  bankruptcy: 'Konkurs', closed: 'Lukket', comeback: 'Comeback',
  rebrand: 'Rebranding', funding_round: 'Fundingrunde',
  milestone: 'Milepæl', other: 'Anden hændelse',
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

// Skeleton-placeholders — vises mens data hentes (styles i style.css §SKELETON)
function renderSkeletonCards(count) {
  return Array.from({ length: count }, () => '<div class="skeleton skeleton-card"></div>').join('');
}
function renderSkeletonRows(count, cols) {
  return Array.from({ length: count }, () =>
    `<tr class="skeleton-row"><td colspan="${cols}"><div class="skeleton skeleton-line"></div></td></tr>`).join('');
}

// Redaktionelt investorkort. M er et element fra buildInvestorIndex().investors.
function renderInvestorCard(m, latestSeason) {
  const isActive = m.status === 'aktiv';

  // Spænd-chippen viser PANEL-sæsoner (hvornår de sad i hulen), ikke kun deal-sæsoner
  const seasons = m.panelSeasons;
  const span = seasons.length === 1
    ? `S${seasons[0]}`
    : `S${seasons[0]}–S${seasons[seasons.length - 1]}`;

  return `
    <a class="entity-card investor-entity-card" href="${investorUrl(m.name)}">
      <span class="entity-card-main">
        <span class="entity-card-kicker">${isActive ? `Aktiv investor · sæson ${latestSeason}` : m.status === 'gaest' ? 'Gæsteinvestor' : 'Tidligere investor'}</span>
        <strong>${esc(m.name)}</strong>
        <span class="entity-card-summary">${m.deals} registrerede TV-aftaler · ${fmt(m.received)} i registreret TV-beløb</span>
      </span>
      <span class="entity-card-meta"><span>Panelperiode ${span}</span><span>${m.largest ? `Største registrerede aftale: ${esc(m.largest.name)} · ${fmt(m.largest.received)}` : 'Ingen TV-aftale registreret'}</span></span>
      <span class="entity-card-action" aria-hidden="true">Se investor →</span>
    </a>`;
}

// Sæsonprofil — færdigkomponerede sæsondata fra Trykpressen.
function renderSeasonProfile(p) {
  const panelLinks = p.panel.map(person =>
    `<a class="text-link" href="/loever/${esc(person.slug)}/">${esc(person.name)}${person.role === 'gaest' ? ' · gæst' : ''}</a>`
  ).join('');
  const rows = p.deals.map(deal => `
    <tr>
      <td><a class="company-name" href="${companyUrl(deal.name)}">${esc(deal.name)}</a></td>
      <td class="num">${deal.episode == null ? 'Ikke dokumenteret' : deal.episode}</td>
      <td><span class="deal-outcome ${deal.aftale ? 'has-deal' : 'no-deal'}">${deal.aftale ? 'Aftale på TV' : 'Ingen aftale på TV'}</span></td>
      <td class="num">${deal.aftale ? knownMoney(deal.received) : 'Ikke relevant'}</td>
      <td>${deal.investorList.length ? esc(deal.investorList.join(', ')) : 'Ingen investorer'}</td>
      <td class="num">${deal.afterlifeCount}</td>
    </tr>`).join('');
  const events = p.events.length
    ? p.events.map(item => `<div class="season-event"><a class="season-event-company" href="${companyUrl(item.companyName)}">${esc(item.companyName)}</a>${renderArchiveEvent(item.event)}</div>`).join('')
    : '<div class="empty-state"><strong>Ingen efterlivshændelser er knyttet til sæsonen endnu.</strong><span>Det beskriver arkivets nuværende kildedækning, ikke nødvendigvis virksomhedernes faktiske udvikling.</span></div>';
  return `
    <article class="season-profile company-profile">
      <header class="company-profile-header">
        <div class="profile-eyebrow">Løvens Hule · ${esc(p.year)}</div>
        <h1>Sæson ${p.season}</h1>
        <p>Et samlet opslag over registrerede pitches, TV-aftaler, panel og dokumenteret efterliv. TV-vilkår og senere hændelser vises som to forskellige datalag.</p>
      </header>
      <nav class="profile-nav" aria-label="På denne side"><a href="#overblik">Overblik</a><a href="#panel">Panel</a><a href="#pitches">Pitches</a><a href="#efterliv">Efterliv</a></nav>
      <section class="profile-section" id="overblik">
        <div class="section-heading"><span class="section-kicker">01 · Overblik</span><h2>Sæsonen i arkivet</h2></div>
        <dl class="fact-grid">
          <div><dt>År</dt><dd class="num">${esc(p.year)}</dd></div><div><dt>Registrerede pitches</dt><dd class="num">${p.deals.length}</dd></div>
          <div><dt>TV-aftaler</dt><dd class="num">${p.closedCount}</dd></div><div><dt>Uden TV-aftale</dt><dd class="num">${p.deals.length - p.closedCount}</dd></div>
          <div><dt>Registreret TV-beløb</dt><dd class="num">${fmt(p.amount)}</dd></div><div><dt>Dokumenterede efterlivshændelser</dt><dd class="num">${p.events.length}</dd></div>
        </dl>
        ${p.season <= 4 ? '<p class="context-note"><strong>Dækningsforbehold:</strong> Pitchdækningen for sæson 1–4 er ufuldstændig. Antal og rater kan derfor ikke sammenlignes direkte med senere sæsoner.</p>' : ''}
      </section>
      <section class="profile-section" id="panel"><div class="section-heading"><span class="section-kicker">02 · Panel</span><h2>Investorer i sæsonen</h2></div><div class="text-links">${panelLinks}</div></section>
      <section class="profile-section" id="pitches">
        <div class="section-heading"><span class="section-kicker">03 · TV-laget</span><h2>Alle registrerede pitches</h2><p>Efterlivskolonnen tæller kun kildebelagte hændelser i arkivet.</p></div>
        <div class="table-wrap"><table><thead><tr><th>Virksomhed</th><th class="num">Afsnit</th><th>Udfald</th><th class="num">TV-beløb</th><th>Investorer</th><th class="num">Efterliv</th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>
      <section class="profile-section" id="efterliv"><div class="section-heading"><span class="section-kicker">04 · Efter kameraerne</span><h2>Dokumenteret efterliv</h2><p>Hændelserne sorteres efter dato og viser kildernes confidence.</p></div><div class="timeline season-timeline">${events}</div></section>
      <nav class="adjacent-nav" aria-label="Andre sæsoner">${p.previous ? `<a href="/saesoner/${p.previous}/">← Sæson ${p.previous}</a>` : '<span></span>'}${p.next ? `<a href="/saesoner/${p.next}/">Sæson ${p.next} →</a>` : ''}</nav>
    </article>`;
}

// Registerpost — samme komponent på tværs af eventtyper.
function renderRegisterEntry(item) {
  return `
    <article class="register-entry">
      <header><div><span class="section-kicker">${EVENT_TYPE_LABELS[item.event.event_type] || 'Hændelse'} · ${fmtEventDate(item.event.event_date, item.event.date_precision)}</span><h2><a href="${companyUrl(item.companyName)}">${esc(item.companyName)}</a></h2></div><a class="section-link" href="${companyUrl(item.companyName)}#efterliv">Se hele sagen →</a></header>
      <p class="register-tv-context">${esc(item.dealSummary)}</p>
      ${renderArchiveEvent(item.event).trimStart()}
    </article>`;
}
