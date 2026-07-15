/* ═══════════════════════════════════════════════════════════════
   js/supabase.js — Supabase config + data loading (normaliseret model)
   ═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://upaxzfytumsijnbhjihd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYXh6Znl0dW1zaWpuYmhqaWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjEwMzIsImV4cCI6MjA5MDczNzAzMn0.GOB9cg8CWmC2Qn73Wg2A9AEoDrOKjB7IXZwndXwfKSk';

// Investor-status fra investor_status-viewet (panel_memberships i databasen
// er sandheden — aldrig hardcodet i frontend). Udfyldes af loadDeals();
// læses af buildInvestorIndex() i helpers.js.
var INVESTOR_STATUS = {};

// Sæson → år (fra seasons-tabellen). Udfyldes af loadDeals().
var SEASON_YEARS = {};

// Virksomheds-slugs (fra companies-tabellen) — slug er nøglen i URL-laget,
// navnet forbliver intern nøgle i aggregeringerne. Udfyldes af loadDeals();
// læses af companyUrl() i helpers.js og slug-opslag på companies.html.
var COMPANY_SLUGS = {};   // name → slug
var COMPANY_NAMES = {};   // slug → name
var COMPANIES = {};       // name → fuld virksomhedsidentitet

// Læsestien går gennem det trykte arkiv (/data/arkiv.json fra seneste
// build) — Supabase er redaktionsdatabase, CDN'en er publikationen.
// Fallback til live REST når arkivet ikke findes (lokal udvikling uden tryk).
var ARKIV = null;
var ARKIV_PROMISE = null;
const REST_PAGE_SIZE = 1000;
const REST_MAX_PAGES = 1000;

async function sbFetchRestAll(path) {
  const cleanPath = path
    .replace(/([?&])(?:limit|offset)=[^&]*&?/g, '$1')
    .replace(/[?&]$/, '');
  const rows = [];
  let offset = 0;
  for (let page = 0; page < REST_MAX_PAGES; page++) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${cleanPath}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
        'Range': `${offset}-${offset + REST_PAGE_SIZE - 1}`,
        'Range-Unit': 'items',
      }
    });
    if (!response.ok) {
      console.error('Supabase fejl:', response.status, await response.text());
      throw new Error('Supabase svarede med status ' + response.status);
    }
    const pageRows = await response.json();
    if (!Array.isArray(pageRows)) throw new Error('Supabase-svaret er ikke en liste');
    if (!pageRows.length) return rows;

    rows.push(...pageRows);
    offset += pageRows.length;
    const totalRaw = response.headers.get('content-range')?.split('/')[1];
    const total = Number(totalRaw);
    if (Number.isFinite(total) && offset >= total) return rows;
  }
  throw new Error(`Supabase-pagination overskred ${REST_MAX_PAGES} sider`);
}

async function sbFetch(path) {
  if (ARKIV === null) {
    if (!ARKIV_PROMISE) {
      ARKIV_PROMISE = (async () => {
        try {
          const r = await fetch('/data/arkiv.json');
          ARKIV = r.ok ? await r.json() : false;
        } catch (e) {
          ARKIV = false;
        } finally {
          ARKIV_PROMISE = null;
        }
        return ARKIV;
      })();
    }
    await ARKIV_PROMISE;
  }
  const key = path.split('?')[0];
  if (ARKIV && ARKIV[key]) return ARKIV[key];
  return sbFetchRestAll(path);
}

// Henter alle deals (med investor-relationer via deal_investors) samt
// investor-status, og returnerer deals i det format resten af koden forventer
async function loadDeals() {
  const [rows, statuses, seasons, companies] = await Promise.all([
    sbFetch('deals?select=id,saeson,afsnit,soeger,andel_tilbudt,beloeb_modtaget,andel_solgt,aftale,company:companies(name,slug,category,status),deal_investors(investor:investors(canonical_name))&order=saeson.asc,afsnit.asc,id.asc'),
    sbFetch('investor_status?select=canonical_name,slug,status,first_season,last_season,panel_seasons'),
    sbFetch('seasons?select=season_number,year'),
    sbFetch('companies?select=id,name,slug,category,status,cvr_nummer&order=name.asc,id.asc'),
  ]);

  INVESTOR_STATUS = Object.fromEntries(statuses.map(s => [s.canonical_name, s]));
  SEASON_YEARS = Object.fromEntries(seasons.map(s => [s.season_number, s.year]));
  COMPANY_SLUGS = Object.fromEntries(companies.map(c => [c.name, c.slug]));
  COMPANY_NAMES = Object.fromEntries(companies.map(c => [c.slug, c.name]));
  COMPANIES = Object.fromEntries(companies.map(c => [c.name, c]));

  return rows.map(row => {
    const investorList = row.deal_investors.map(di => di.investor.canonical_name).sort();
    return {
      // Virksomhedsfakta kommer fra companies-relationen — deals ejer kun
      // TV-øjeblikkets tal. Én redigerbar sandhed pr. domænefaktum.
      id:           row.id,
      name:         row.company.name,
      slug:         row.company.slug,
      season:       row.saeson,
      episode:      row.afsnit,
      asked:        row.soeger,
      shareOffered: row.andel_tilbudt,
      received:     row.beloeb_modtaget,
      shareSold:    row.andel_solgt,
      investors:    investorList.join(', '),   // visningsstreng (fx title-attributter)
      investorList,
      category:     row.company.category || '',
      status:       row.company.status || '',
      aftale:       row.aftale,
      // Beregn valuations fra de rå tal
      valBefore:    row.soeger && row.andel_tilbudt
                      ? Math.round(row.soeger / (row.andel_tilbudt / 100))
                      : null,
      valAfter:     row.beloeb_modtaget && row.andel_solgt
                      ? Math.round(row.beloeb_modtaget / (row.andel_solgt / 100))
                      : null,
    };
  });
}

// ─── Arkivet: efterlivs-events + kilder (fodnoter) ───
// Kaldes kun på sider med sagsprofiler (companies.html). Fejler blødt:
// arkivlaget er berigelse — profilen skal kunne vises uden.
var COMPANY_EVENTS = {};  // company-slug → [events, kronologisk]
var SOURCES = {};         // 'entity_type:entity_id' → [kilder]
var ARCHIVE_EVENTS = [];  // flad liste til forsiden og registre
var ARCHIVE_AVAILABLE = false;

async function loadCompanyArchive() {
  try {
    const [events, sources] = await Promise.all([
      sbFetch('company_events?select=id,event_date,date_precision,event_type,title,description,amount,created_at,updated_at,company:companies(slug)&order=event_date.asc,id.asc'),
      sbFetch('sources?select=id,entity_type,entity_id,field_name,source_name,source_url,note,confidence&order=id.asc'),
    ]);
    ARCHIVE_EVENTS = events;
    COMPANY_EVENTS = {};
    events.forEach(e => {
      (COMPANY_EVENTS[e.company.slug] = COMPANY_EVENTS[e.company.slug] || []).push(e);
    });
    SOURCES = {};
    sources.forEach(s => {
      const k = s.entity_type + ':' + s.entity_id;
      (SOURCES[k] = SOURCES[k] || []).push(s);
    });
    ARCHIVE_AVAILABLE = true;
  } catch (err) {
    ARCHIVE_AVAILABLE = false;
    console.error('Arkiv-data kunne ikke hentes (profilen vises uden efterliv):', err);
  }
}
