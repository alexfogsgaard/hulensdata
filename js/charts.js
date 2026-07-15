/* Fase 3 · deskriptive analyser. Tabeller er den tilgængelige grundvisning;
   Chart.js er en sekundær visualisering, som må fejle uden at skjule data. */

const EVENT_LABELS = {
  renegotiated: 'Genforhandlet aftale',
  cancelled: 'Samarbejde ophørt',
  follow_on_investment: 'Opfølgende investering',
  exit: 'Exit',
  bankruptcy: 'Konkurs',
  closed: 'Lukning',
  comeback: 'Comeback',
  rebrand: 'Rebranding',
  funding_round: 'Fundingrunde',
  milestone: 'Milepæl',
  other: 'Anden hændelse',
};

const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const chartColors = {
  primary: token('--gold'),
  secondary: token('--green'),
  light: token('--surface2'),
  grid: token('--border'),
  text: token('--muted'),
  strong: token('--text'),
  surface: token('--surface2'),
  border: token('--border'),
};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const percent = (known, total) => total ? Math.round(known / total * 100) : 0;
const coverage = (known, total) => `${known} af ${total} · ${percent(known, total)} %`;
const millions = value => (value / 1000000).toLocaleString('da-DK', { maximumFractionDigits: 1 });
const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0);
const bySeason = (deals, season) => deals.filter(deal => deal.season === season);

function chartOptions({ yTitle, percentAxis = false, legend = false } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 450 },
    plugins: {
      legend: { display: legend, labels: { usePointStyle: true, color: chartColors.text, font: { family: 'Archivo' } } },
      tooltip: {
        backgroundColor: chartColors.surface,
        titleColor: chartColors.strong,
        bodyColor: chartColors.text,
        borderColor: chartColors.border,
        borderWidth: 1,
      },
    },
    scales: {
      x: { ticks: { color: chartColors.text, font: { family: 'Archivo' } }, grid: { color: chartColors.grid } },
      y: {
        beginAtZero: true,
        title: { display: Boolean(yTitle), text: yTitle, color: chartColors.text },
        ticks: { color: chartColors.text, callback: percentAxis ? value => `${value} %` : undefined, font: { family: 'Archivo' } },
        grid: { color: chartColors.grid },
      },
    },
  };
}

function renderChart(id, config) {
  const canvas = document.getElementById(id);
  if (typeof Chart !== 'function') {
    canvas.hidden = true;
    document.getElementById(`${id}-status`).hidden = false;
    return;
  }
  new Chart(canvas, config);
}

function tableRows(id, rows) {
  document.getElementById(id).innerHTML = rows.join('');
}

function meta(id, text) {
  document.getElementById(id).textContent = text;
}

function seasonMetrics(deals, season) {
  const rows = bySeason(deals, season);
  const closed = rows.filter(deal => deal.aftale);
  const slugs = [...new Set(rows.map(deal => deal.slug))];
  const events = ARCHIVE_EVENTS.filter(event => slugs.includes(event.company.slug));
  const cvr = slugs.filter(slug => {
    const name = COMPANY_NAMES[slug];
    return name && COMPANIES[name]?.cvr_nummer;
  }).length;
  return {
    pitches: rows.length,
    closed: closed.length,
    rate: percent(closed.length, rows.length),
    tvAmount: sum(closed, 'received'),
    knownEpisode: rows.filter(deal => deal.episode != null).length,
    knownAsked: rows.filter(deal => deal.asked != null).length,
    knownReceived: closed.filter(deal => deal.received != null).length,
    knownShare: closed.filter(deal => deal.shareSold != null).length,
    companies: slugs.length,
    cvr,
    events: events.length,
  };
}

function renderComparison(deals, seasons, pushState = false) {
  const a = Number(document.getElementById('compare-a').value);
  const b = Number(document.getElementById('compare-b').value);
  const first = seasonMetrics(deals, a);
  const second = seasonMetrics(deals, b);
  document.getElementById('compare-a-heading').textContent = `Sæson ${a}`;
  document.getElementById('compare-b-heading').textContent = `Sæson ${b}`;
  document.getElementById('comparison-caption').textContent = `Sæson ${a} sammenlignet med sæson ${b}`;
  tableRows('comparison-body', [
    ['Registrerede pitches', first.pitches, second.pitches],
    ['Registrerede TV-aftaler', first.closed, second.closed],
    ['Aftaleandel', `${first.rate} %`, `${second.rate} %`],
    ['Registreret TV-beløb', fmt(first.tvAmount), fmt(second.tvAmount)],
    ['Kendt afsnit', coverage(first.knownEpisode, first.pitches), coverage(second.knownEpisode, second.pitches)],
    ['Kendt søgt beløb', coverage(first.knownAsked, first.pitches), coverage(second.knownAsked, second.pitches)],
    ['Kendt TV-beløb', coverage(first.knownReceived, first.closed), coverage(second.knownReceived, second.closed)],
    ['Kendt ejerandel', coverage(first.knownShare, first.closed), coverage(second.knownShare, second.closed)],
    ['Dokumenterede efterlivshændelser', first.events, second.events],
    ['Virksomheder med CVR', coverage(first.cvr, first.companies), coverage(second.cvr, second.companies)],
  ].map(([label, valueA, valueB]) => `<tr><th scope="row">${esc(label)}</th><td class="num">${esc(valueA)}</td><td class="num">${esc(valueB)}</td></tr>`));
  document.getElementById('comparison-status').textContent = `Viser sæson ${a} og sæson ${b}.`;

  if (pushState) {
    const url = new URL(window.location.href);
    url.searchParams.set('season_a', a);
    url.searchParams.set('season_b', b);
    history.pushState({ seasonA: a, seasonB: b }, '', url);
  }
}

function initComparison(deals, seasons) {
  const firstSelect = document.getElementById('compare-a');
  const secondSelect = document.getElementById('compare-b');
  const options = seasons.map(season => `<option value="${season}">Sæson ${season} · ${esc(SEASON_YEARS[season] || 'år ukendt')}</option>`).join('');
  firstSelect.innerHTML = options;
  secondSelect.innerHTML = options;
  const params = new URLSearchParams(window.location.search);
  const requestedA = Number(params.get('season_a'));
  const requestedB = Number(params.get('season_b'));
  firstSelect.value = seasons.includes(requestedA) ? requestedA : seasons.at(-2);
  secondSelect.value = seasons.includes(requestedB) ? requestedB : seasons.at(-1);
  firstSelect.addEventListener('change', () => renderComparison(deals, seasons, true));
  secondSelect.addEventListener('change', () => renderComparison(deals, seasons, true));
  window.addEventListener('popstate', () => {
    const stateParams = new URLSearchParams(window.location.search);
    const a = Number(stateParams.get('season_a'));
    const b = Number(stateParams.get('season_b'));
    firstSelect.value = seasons.includes(a) ? a : seasons.at(-2);
    secondSelect.value = seasons.includes(b) ? b : seasons.at(-1);
    renderComparison(deals, seasons);
  });
  renderComparison(deals, seasons);
}

function renderAnalyses(deals) {
  const seasons = [...new Set(deals.map(deal => deal.season))].sort((a, b) => a - b);
  const seasonRows = seasons.map(season => bySeason(deals, season));
  const closedBySeason = seasonRows.map(rows => rows.filter(deal => deal.aftale));
  const labels = seasons.map(season => `S${season}`);

  meta('meta-seasons', `${deals.length} observationer · 0 udeladt · ingen NULL-felter indgår i optællingen`);
  tableRows('table-seasons', seasons.map((season, index) => `<tr><th scope="row">Sæson ${season}</th><td class="num">${seasonRows[index].length}</td><td class="num">${closedBySeason[index].length}</td></tr>`));
  renderChart('chart-seasons', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Pitches', data: seasonRows.map(rows => rows.length), backgroundColor: chartColors.light, borderColor: chartColors.strong, borderWidth: 1 },
      { label: 'TV-aftaler', data: closedBySeason.map(rows => rows.length), backgroundColor: chartColors.primary, borderColor: chartColors.strong, borderWidth: 1 },
    ] },
    options: chartOptions({ yTitle: 'Antal', legend: true }),
  });

  const rates = seasonRows.map((rows, index) => percent(closedBySeason[index].length, rows.length));
  meta('meta-rate', `${deals.length} observationer · 0 udeladt · aftaleudfald kendt for alle registrerede pitches`);
  tableRows('table-rate', seasons.map((season, index) => `<tr><th scope="row">Sæson ${season}</th><td class="num">${seasonRows[index].length}</td><td class="num">${closedBySeason[index].length}</td><td class="num">${rates[index]} %</td></tr>`));
  renderChart('chart-dealrate', {
    type: 'line',
    data: { labels, datasets: [{ label: 'Aftaleandel', data: rates, borderColor: chartColors.primary, backgroundColor: chartColors.light, fill: true, pointBackgroundColor: chartColors.strong, pointRadius: 4 }] },
    options: chartOptions({ yTitle: 'Andel af pitches', percentAxis: true }),
  });

  const askedKnown = deals.filter(deal => deal.asked != null).length;
  const allClosed = deals.filter(deal => deal.aftale);
  const receivedKnown = allClosed.filter(deal => deal.received != null).length;
  meta('meta-amounts', `Søgt beløb: ${askedKnown} observationer, ${deals.length - askedKnown} NULL · TV-beløb: ${receivedKnown} observationer, ${allClosed.length - receivedKnown} NULL blandt aftaler`);
  tableRows('table-amounts', seasons.map((season, index) => {
    const rows = seasonRows[index];
    const closed = closedBySeason[index];
    const knownAsk = rows.filter(deal => deal.asked != null).length;
    const knownReceived = closed.filter(deal => deal.received != null).length;
    return `<tr><th scope="row">Sæson ${season}</th><td class="num">${millions(sum(rows, 'asked'))} mio.</td><td class="num">${coverage(knownAsk, rows.length)}</td><td class="num">${millions(sum(closed, 'received'))} mio.</td><td class="num">${coverage(knownReceived, closed.length)}</td></tr>`;
  }));
  renderChart('chart-amounts', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Søgt beløb', data: seasonRows.map(rows => sum(rows, 'asked') / 1000000), backgroundColor: chartColors.light, borderColor: chartColors.strong, borderWidth: 1 },
      { label: 'Registreret TV-beløb', data: closedBySeason.map(rows => sum(rows, 'received') / 1000000), backgroundColor: chartColors.primary, borderColor: chartColors.strong, borderWidth: 1 },
    ] },
    options: chartOptions({ yTitle: 'Millioner kroner', legend: true }),
  });

  const investorBuckets = new Map();
  allClosed.forEach(deal => investorBuckets.set(deal.investorList.length, (investorBuckets.get(deal.investorList.length) || 0) + 1));
  const investorRows = [...investorBuckets.entries()].sort((a, b) => a[0] - b[0]);
  const missingInvestors = investorBuckets.get(0) || 0;
  meta('meta-investors', `${allClosed.length} TV-aftaler · ${missingInvestors} uden investor-relation · relationer er kendt for ${allClosed.length - missingInvestors}`);
  tableRows('table-investor-count', investorRows.map(([count, total]) => `<tr><th scope="row">${count || 'Ingen dokumenteret'}</th><td class="num">${total}</td><td class="num">${percent(total, allClosed.length)} %</td></tr>`));
  renderChart('chart-investor-count', {
    type: 'bar',
    data: { labels: investorRows.map(([count]) => count || 'Ukendt'), datasets: [{ label: 'TV-aftaler', data: investorRows.map(([, total]) => total), backgroundColor: chartColors.primary, borderColor: chartColors.strong, borderWidth: 1 }] },
    options: chartOptions({ yTitle: 'TV-aftaler' }),
  });

  const eventCounts = new Map();
  ARCHIVE_EVENTS.forEach(event => eventCounts.set(event.event_type, (eventCounts.get(event.event_type) || 0) + 1));
  const eventRows = [...eventCounts.entries()].sort((a, b) => b[1] - a[1] || (EVENT_LABELS[a[0]] || a[0]).localeCompare(EVENT_LABELS[b[0]] || b[0], 'da'));
  meta('meta-events', `${ARCHIVE_EVENTS.length} dokumenterede hændelser · 0 udeladt · hændelsestype kendt for alle`);
  tableRows('table-events', eventRows.map(([type, total]) => `<tr><th scope="row">${esc(EVENT_LABELS[type] || 'Anden hændelse')}</th><td class="num">${total}</td><td class="num">${percent(total, ARCHIVE_EVENTS.length)} %</td></tr>`));
  renderChart('chart-events', {
    type: 'bar',
    data: { labels: eventRows.map(([type]) => EVENT_LABELS[type] || 'Anden hændelse'), datasets: [{ label: 'Hændelser', data: eventRows.map(([, total]) => total), backgroundColor: chartColors.primary, borderColor: chartColors.strong, borderWidth: 1 }] },
    options: { ...chartOptions({ yTitle: 'Hændelser' }), indexAxis: 'y' },
  });

  const cvrRows = seasons.map(season => {
    const slugs = [...new Set(bySeason(deals, season).map(deal => deal.slug))];
    const known = slugs.filter(slug => {
      const name = COMPANY_NAMES[slug];
      return name && COMPANIES[name]?.cvr_nummer;
    }).length;
    return { season, total: slugs.length, known, rate: percent(known, slugs.length) };
  });
  const companySeasonObservations = cvrRows.reduce((total, row) => total + row.total, 0);
  const companySeasonKnown = cvrRows.reduce((total, row) => total + row.known, 0);
  meta('meta-cvr', `${companySeasonObservations} virksomhed-sæson-observationer · ${companySeasonObservations - companySeasonKnown} uden dokumenteret CVR`);
  tableRows('table-cvr', cvrRows.map(row => `<tr><th scope="row">Sæson ${row.season}</th><td class="num">${row.total}</td><td class="num">${row.known}</td><td class="num">${row.rate} %</td></tr>`));
  renderChart('chart-cvr', {
    type: 'line',
    data: { labels, datasets: [{ label: 'CVR-dækning', data: cvrRows.map(row => row.rate), borderColor: chartColors.secondary, backgroundColor: chartColors.light, fill: true, pointBackgroundColor: chartColors.strong, pointRadius: 4 }] },
    options: chartOptions({ yTitle: 'Andel med CVR', percentAxis: true }),
  });

  initComparison(deals, seasons);
}

async function init() {
  const deals = await loadDeals();
  await loadCompanyArchive();
  renderHeaderStats(deals);
  renderAnalyses(deals);
}

init().catch(error => {
  console.error(error);
  showLoadError();
});
