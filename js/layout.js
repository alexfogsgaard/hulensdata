/* ═══════════════════════════════════════════════════════════════
   js/layout.js — fælles layout-elementer (header/nav)
   ═══════════════════════════════════════════════════════════════ */

const NAV_PAGES = [
  { id: 'deals',     href: 'deals.html',     label: 'Deals' },
  { id: 'investors', href: 'investors.html', label: 'Investorer' },
  { id: 'companies', href: 'companies.html', label: 'Virksomheder' },
  { id: 'charts',    href: 'charts.html',    label: 'Grafer' },
];

// Udfylder <header class="site-header"> med wordmark, nav og stats-container.
// Kaldes synkront i et <script> lige efter header-elementet — ingen FOUC,
// ingen DOMContentLoaded-afhængighed. #header-stats udfyldes bagefter af
// renderHeaderStats() i helpers.js som hidtil.
function renderSiteHeader(activePage) {
  const host = document.querySelector('.site-header');
  if (!host) return;
  host.innerHTML = `
    <a class="wordmark" href="index.html">Hulens <span>Data</span></a>
    <nav class="site-nav">
      ${NAV_PAGES.map(p =>
        `<a href="${p.href}"${p.id === activePage ? ' class="active"' : ''}>${p.label}</a>`
      ).join('\n      ')}
    </nav>
    <div class="header-stats" id="header-stats"></div>
  `;
}
