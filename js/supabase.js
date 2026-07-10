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

async function sbFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  if (!res.ok) {
    console.error('Supabase fejl:', res.status, await res.text());
    throw new Error('Supabase svarede med status ' + res.status);
  }
  return res.json();
}

// Henter alle deals (med investor-relationer via deal_investors) samt
// investor-status, og returnerer deals i det format resten af koden forventer
async function loadDeals() {
  const [rows, statuses, seasons] = await Promise.all([
    sbFetch('deals?select=virksomhed,saeson,afsnit,saeson_afsnit,soeger,andel_tilbudt,beloeb_modtaget,andel_solgt,kategori,status,aftale,deal_investors(investor:investors(canonical_name))&order=saeson.asc,afsnit.asc&limit=1000'),
    sbFetch('investor_status?select=canonical_name,slug,status,first_season,last_season,panel_seasons'),
    sbFetch('seasons?select=season_number,year'),
  ]);

  INVESTOR_STATUS = Object.fromEntries(statuses.map(s => [s.canonical_name, s]));
  SEASON_YEARS = Object.fromEntries(seasons.map(s => [s.season_number, s.year]));

  return rows.map(row => {
    const investorList = row.deal_investors.map(di => di.investor.canonical_name).sort();
    return {
      name:         row.virksomhed,
      season:       row.saeson,
      episode:      row.afsnit,
      saeson_afsnit: row.saeson_afsnit,
      asked:        row.soeger,
      shareOffered: row.andel_tilbudt,
      received:     row.beloeb_modtaget,
      shareSold:    row.andel_solgt,
      investors:    investorList.join(', '),   // visningsstreng (fx title-attributter)
      investorList,
      category:     row.kategori || '',
      status:       row.status || '',
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
