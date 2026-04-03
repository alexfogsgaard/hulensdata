/* ═══════════════════════════════════════════════════════════════
   js/supabase.js — Supabase config + data loading
   ═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://upaxzfytumsijnbhjihd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYXh6Znl0dW1zaWpuYmhqaWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjEwMzIsImV4cCI6MjA5MDczNzAzMn0.GOB9cg8CWmC2Qn73Wg2A9AEoDrOKjB7IXZwndXwfKSk';

// Henter alle deals fra Supabase og returnerer dem i det format
// resten af koden forventer
async function loadDeals() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/deals?select=*&order=saeson.asc,afsnit.asc&limit=1000`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    }
  );

  if (!res.ok) {
    console.error('Supabase fejl:', res.status, await res.text());
    return [];
  }

  const data = await res.json();

  return data.map(row => ({
    name:         row.virksomhed,
    season:       row.saeson,
    episode:      row.afsnit,
    saeson_afsnit: row.saeson_afsnit,
    asked:        row.soeger,
    shareOffered: row.andel_tilbudt,
    received:     row.beloeb_modtaget,
    shareSold:    row.andel_solgt,
    investors:    row.investor || '',
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
    // investorList udfyldes af helpers.js
    investorList: parseInvestors(row.investor || ''),
  }));
}
