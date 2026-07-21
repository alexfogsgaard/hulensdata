# Teknisk repo-review — 22. juli 2026

## Konklusion

Der er **ingen ny kode- eller datablokker i dette review, som i sig selv bør stoppe merge af den allerede Fable-godkendte PR #5**. `npm run verify` er grøn på det reviewede head `19220734133abe4ca33a0ea9637d2c4dc6069afe`, og de eksisterende guards dækker de vigtigste data-, build-, link- og SEO-fejl med kontrollerede mutationstests.

Der er derimod to operationelle gates før næste udviklingsrunde:

1. Netlify er både deploymekanisme og eneste fjernkørte buildgate. Når projektet er pauset, findes der ingen uafhængig CI-evidens på nye commits.
2. Næste produktionsskrivning eller DDL-ændring må vente på versionsstyrede migrationer, eksplicit grant-design og en dokumenteret recovery/restore-rehearsal. RLS er aktiv, men kan ikke alene erstatte privileges, migrationer eller recovery-bevis.

Den vigtigste arkitekturrisiko er, at Netlify publicerer repo-roden (`publish = "."`). Det gør produktionsoutput, kildekode, værktøjer, schemas, fixtures og intern projekt-dokumentation til én deployflade. Det er håndterbart i dag, fordi levende research holdes uden for repoet, men grænsen er for let at bryde ved en senere commit.

## Scope og evidens

- Reviewbranch: `agent/repo-technical-review-2026-07-22`.
- Baseline: PR #5-head `1922073`; reviewet er bevidst lavet oven på den endnu ikke mergede, Fable-godkendte fase 4A-branch.
- Repo: 74 trackede filer; ingen tredjeparts-`npm`-dependencies og ingen versionsstyrede Supabase-migrationsfiler.
- `npm run verify`: **PASS**. Det omfattede syntaks, pagination, atomisk snapshot/fallback, live read-only datahentning, datavalidering, Trykpressen, buildvalidering, interne links, SEO, statisk a11y, 18 mutation guards og 23 fase 4A-tests.
- Kontrolleret snapshot: 325 virksomheder, 329 pitches, 300 deal-investor-relationer, 18 investorer, 11 sæsoner, 61 panelrelationer, 22 events og 65 kilder. Trykpressen genererede 325 virksomhedsprofiler og et sitemap med 364 URL'er.
- Browser-spotcheck via lokal statisk server ved 375 px: global søgning efter Ladybox inkl. piletaster/active descendant, kombinerede pitchfiltre med URL-state, analyser med sæsonsammenligning og horisontale tabeller. Ingen dokumentbredde-overflow eller runtime-fejl blev set på disse journeys; browseren bad dog om en ikke-eksisterende `/favicon.ico`.
- Supabase read-only katalog/advisors: alle otte tabeller har RLS; `investor_status` er `security_invoker`; Security Advisor rapporterede 0 fund. Performance Advisor rapporterede to aktuelt ubrugte FK-indeks. Ingen databaseændringer blev udført.
- `npm run verify` ændrede footerens snapshotdato i fire trackede registerfiler. De genererede diffs blev verificeret og gendannet før reviewcommitten.

Estimatet **Production deploy** betyder et Netlify-production-deploy. En databaseændring er markeret særskilt, fordi den kræver manuel produktionsautorisation, selv når den ikke kræver Netlify.

## 1. Blockers

### B1 — Der mangler en uafhængig CI-gate, mens Netlify er pauset

- **Fil/sted:** ingen `.github/workflows/*`; `netlify.toml:3-5`; `package.json:4-18`.
- **Problem:** `npm run verify` er en stærk lokal gate, men køres ikke i en separat CI. Netlify er både build og hosting, og et pauset projekt pauser også deploy previews.
- **Konsekvens:** nye commits kan merges uden reproducerbar fjern-evidens. PR #5 har lokal/Fable-evidens, men samme sikkerhed følger ikke automatisk med næste branch.
- **Anbefalet løsning:** etabler GitHub Actions eller anden kredit-uafhængig CI. Del først gaterne i en hermetisk, offline del (syntaks, fixtures, pagination, mutationstests) og en eksplicit live read-only snapshot/build-del. Beskyt main med den hermetiske check; kør live-check manuelt/natligt eller på godkendte heads, så produktionens REST-data ikke bliver en skjult flakiness-kilde.
- **Estimeret risiko:** lav til middel; workflow- og testopdeling kan afsløre implicitte afhængigheder, men ændrer ikke runtime.
- **Production deploy:** nej. Committen bør markeres `[skip netlify]`, indtil en ignore-regel er aktiv.

### B2 — Fremtidig database-apply/DDL mangler versionsstyret migrations- og recoverygrundlag

- **Fil/sted:** ingen `supabase/migrations/*`; `docs/phase-4-implementation-plan.md:33-50`; `docs/phase-4-risk-register.md` R11, R16 og R20; `docs/phase-4a-operations.md:59-70`.
- **Problem:** live Supabase har 16 migrationsposter, men migrations-SQL, fuldt schema, policies og grants er ikke en autoritativ, versionsstyret del af repoet. Den senest inventerede backup er en dataeksport og der er ingen isoleret restore rehearsal.
- **Konsekvens:** en schemaændring kan ikke sikkert reviewes, reproduceres eller rulles tilbage ud fra repoet alene. “Backup” kan blive fejltolket som recovery-evne.
- **Anbefalet løsning:** før enhver write/DDL: vælg én kanonisk migrationsplacering, eksportér og afstem live schema/migrations/policies/grants read-only, byg et fuldt recovery-set og bevis restore i et isoleret projekt. Først derefter designes apply.
- **Estimeret risiko:** middel for den read-only kortlægning; høj for senere restore-/DDL-arbejde, som kræver særskilt review og godkendelse.
- **Production deploy:** nej. Senere Supabase-ændringer er produktionsdatabaseændringer og kræver eksplicit manuel autorisation.

### Ekstern releaseblokering — Netlify credits

Netlify-production kan ikke opdateres, mens projektet er pauset. Det er ikke en kodefejl og ændrer ikke PR #5's mergevurdering, men merge og release er to forskellige handlinger: et merge uden et efterfølgende succesfuldt production deploy gør ikke ændringen live. Undgå at genoptage deploys for docs-only commits.

## 2. Høj værdi / lav risiko

### H1 — Stop dokumentations- og fixtureændringer fra at udløse production builds

- **Fil/sted:** `netlify.toml:3-5`; ingen `[build].ignore` eller context-regler.
- **Problem:** alle merges til production branch kan starte `npm run verify`, også når diffen kun er `docs/`, `schemas/` eller syntetiske `test/fixtures/`. Netlify credit-based billing tager credits for production deploys; deploy previews er normalt gratis, men alle deploytyper er pauset, når projektet er pauset.
- **Konsekvens:** credits kan bruges på commits uden publicerbar siteændring. Det øger også incitamentet til at springe nødvendige kontroller over.
- **Anbefalet løsning:** tilføj en lille, testet ignore-beslutning, der bygger ved ændringer i HTML, CSS, JS, `_redirects`, `netlify.toml`, `package.json`, Trykpressen eller publiceringsdata, men skipper rene docs-/fixtureændringer. Bevar build hooks som eksplicit data-publiceringsvej; Netlifys ignore-kommando gælder ikke build-hook-deploys. Brug `[skip netlify]` på kendte docs-only commits og deploy-lock/stop auto publishing i UI under kreditpausen. Se Netlifys aktuelle dokumentation for [ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/), [deploykontrol](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/) og [credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).
- **Estimeret risiko:** lav, hvis path-matricen mutationstestes. En for bred ignore-regel kan ellers skjule en nødvendig deploy.
- **Production deploy:** ja, én bevidst config-deploy kan være nødvendig for at aktivere repo-reglen; UI-lock kræver ikke deploy. Derefter sparer reglen production deploys.

### H2 — Gør `npm run verify` reproducerbar uden trackede build-diffs

- **Fil/sted:** `.gitignore:6-12`; `tools/tryk.mjs:28,134-138`; trackede `arkiv/index.html` og tre registerundersider.
- **Problem:** profiler, data og sitemap er ignorerede buildartefakter, mens fire registerfiler er trackede, selv om Trykpressen regenererer dem. En grøn verify ændrede kun deres footer fra snapshot 20.07 til 21.07 og efterlod arbejdstræet dirty.
- **Konsekvens:** “grøn test” og “rent arbejdstræ” er ikke længere samme bevis. Reelle kode-diffs kan drukne i datostøj, og lokale resultater afhænger af hvornår live snapshot blev hentet.
- **Anbefalet løsning:** vælg én konsekvent model. Den mindst risikable er at gøre alle Trykpressens registeroutputs til ignorerede artefakter og sikre, at en ren Netlify-build altid genererer dem. Tilføj en test, der kører build to gange fra samme fixture-snapshot og kræver byteidentisk output og rent tracked tree.
- **Estimeret risiko:** lav til middel; routing skal kontrolleres på en ren clone, før de trackede filer fjernes.
- **Production deploy:** ja, fordi de publicerede registerfiler skifter ejerskab fra source til buildoutput.

### H3 — Fjern race og dobbelt-fetch i global søgning

- **Fil/sted:** `js/layout.js:52-101` og `165-198`.
- **Problem:** `ensureSearchIndex()` cacher resultatet, men ikke den igangværende promise. Focus og input kan derfor starte samme 88 KB-fetch parallelt. Flere asynkrone `update()`-kald har ingen generationsmarkør, så et ældre svar kan male resultater efter et nyere input.
- **Konsekvens:** unødige requests på langsomme forbindelser og sporadisk forældede søgeresultater; svært at reproducere manuelt.
- **Anbefalet løsning:** cache `SEARCH_INDEX_PROMISE`, ryd den kontrolleret efter completion, og brug request-id eller AbortController/debounce, så kun seneste query må opdatere DOM. Tilføj en fixturetest med forsinkede svar i omvendt rækkefølge.
- **Estimeret risiko:** lav.
- **Production deploy:** ja.

### H4 — Vis snapshotfejl som ukendt/degraderet tilstand, ikke som nul

- **Fil/sted:** `js/supabase.js:146-174`; forsiden kalder deals og arkiv sammen.
- **Problem:** `loadCompanyArchive()` sluger enhver event/source-fejl og nulstiller globale samlinger. På sider, der viser totaler, kan “data kunne ikke hentes” derfor ligne “0 dokumenterede hændelser/kilder”.
- **Konsekvens:** en transport- eller kontraktfejl kan publiceres som et tilsyneladende faktuelt nul, i strid med projektets NULL-disciplin.
- **Anbefalet løsning:** returnér en eksplicit status (`available/degraded/error`), behold tidligere gyldigt snapshot i samme navigation, og vis en navngivet statusbesked. Beregninger skal vise “ikke tilgængelig”, aldrig 0, når inputlaget mangler. Mutationstest manglende og ugyldig `company_events`/`sources` separat.
- **Estimeret risiko:** lav til middel; alle consumers af arkivstatus skal gennemgås.
- **Production deploy:** ja.

### H5 — Saml hændelseslabels i én kontrakt

- **Fil/sted:** `js/components.js:121-127`, `js/charts.js:4-16`, `tools/tryk.mjs:63-67`.
- **Problem:** samme event-type→label-map findes tre steder med forskellig fallbacktekst.
- **Konsekvens:** en ny gyldig eventtype kan få forskelligt navn i profil, analyse og søgeindeks uden at buildet fejler.
- **Anbefalet løsning:** generér eller eksponér én DOM-fri konstant sammen med helpers, og mutationstest at alle tilladte eventtyper har præcis én neutral label.
- **Estimeret risiko:** lav.
- **Production deploy:** ja.

### H6 — Fjern den døde dynamiske detaljevej og tilføj favicon

- **Fil/sted:** `companies.html:46-50,132-183`; `investors.html:32-36,75-123`; ingen favicon-reference eller faviconfil.
- **Problem:** gyldige `?name=`-links redirecter til statiske profilsider, men de gamle `showDetail`-implementeringer og skjulte detail-containere ligger stadig i oversigterne. Browser-spotcheck gav desuden 404 på `/favicon.ico`.
- **Konsekvens:** to profilrenderingsveje kan drive fra hinanden, inline-style gør en fremtidig CSP sværere, og alle nye browserbesøg laver et nytteløst request.
- **Anbefalet løsning:** bevis redirects/fallback i test, fjern den utilgængelige legacy-rendering, og tilføj et lille lokalt SVG/ICO med eksplicit `<link rel="icon">` i source og Trykpressens template.
- **Estimeret risiko:** lav, hvis ukendte query-parametre fortsat lander forståeligt på oversigten.
- **Production deploy:** ja.

### H7 — Stram Supabase privileges som defense in depth

- **Fil/sted:** live `public`-schema; dokumenteret i `docs/phase-4-fable-review.md:10-11` og `docs/phase-4-risk-register.md` R11/R12.
- **Problem:** RLS-policyerne er SELECT-only og blokerer aktuelle public writes, men `anon` og `authenticated` har brede tabelprivilegier (bl.a. INSERT/UPDATE/DELETE/TRUNCATE) på de offentlige objekter. Default privileges er også brede. RLS og GRANT er uafhængige lag.
- **Konsekvens:** en senere for bred write-policy, RLS-disable eller forkert ny tabel kan gøre allerede tildelte writes aktive. Der er ingen aktuel exploit fundet, men blast radius er unødigt stor.
- **Anbefalet løsning:** lav en separat, reviewet migration, der eksplicit revoker non-SELECT fra `anon`/`authenticated`, tildeler nødvendige SELECTs, fastlåser default privileges og kører negative anon-write-tests samt Security Advisor før/efter. Bevar nødvendige service-role/admin-privilegier. Tag højde for Supabases annoncerede [ændring af standardgrants for nye tabeller](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), men stol ikke på defaults.
- **Estimeret risiko:** middel; privilegeændringer kan bryde læsning, hvis view/table grants ikke kortlægges komplet.
- **Production deploy:** nej Netlify-deploy; **ja, separat autoriseret produktionsdatabaseændring**.

## 3. Høj værdi / større arbejde

### S1 — Isolér den publicerbare siteflade fra repo-roden

- **Fil/sted:** `netlify.toml:3-5`; `.gitignore`; hele `docs/`, `schemas/`, `test/` og `tools/`.
- **Problem:** `publish = "."` sender hele checkout-roden til Netlifys publishlag. De 74 trackede filer omfatter agentinstruktioner, operationsdocs, JSON-schemas, syntetiske fixtures og buildværktøjer, som ikke er website-assets. `robots.txt` tillader crawling generelt; at en fil ikke står i sitemap er ikke en adgangsgrænse.
- **Konsekvens:** deployfladen og risikoen for utilsigtet eksponering vokser med repoet. En fremtidig operativ fil kan blive offentlig ved én fejlagtig commit, og crawl-/cachefladen er større end nødvendigt.
- **Anbefalet løsning:** lad Trykpressen bygge en ren, allowlistet `dist/`/`_site/` med kun HTML, assets, redirects, robots, sitemap og public snapshot. Valider outputroden for ukendte filer og test fra clean clone. Indtil da må levende research, inbox, revisionslog og backups fortsat ligge uden for repoet.
- **Estimeret risiko:** middel til høj; paths, redirects, Netlify headers og validatorernes root-antagelser skal flyttes samlet.
- **Production deploy:** ja, én nøje QA'et migrationsdeploy.

### S2 — Luk production-fallbacken fra statisk snapshot til live REST

- **Fil/sted:** `js/supabase.js:23-29,73-98`; `tools/test-data-loading.mjs`.
- **Problem:** arkitekturen siger, at CDN-snapshottet er publikationen, men enhver manglende/ufetchbar `/data/arkiv.json` får production-browseren til at læse live Supabase REST. Tests forhindrer blanding inden for én loader, men fallbacken kan stadig vise nyere, uredigeret data end statiske profiler, canonical sider og snapshotdato.
- **Konsekvens:** en CDN-/snapshotfejl omgår publiceringsgaten og skaber inkonsistente sandheder på samme deploy.
- **Anbefalet løsning:** tillad REST-fallback kun på localhost eller via eksplicit development-flag. I production skal snapshotfejl give en synlig degraded-state og bevare sidste atomiske deploy. Tilføj runtime-test for origin/flag og forbud mod live REST på production-host.
- **Estimeret risiko:** middel; lokal udviklingsoplevelse og fejlvisning ændres.
- **Production deploy:** ja.

### S3 — Del Trykpressen i tydelige data-, model-, template- og outputlag

- **Fil/sted:** `tools/tryk.mjs` (513 linjer), især `QUERIES`, søgeindeks, VM-sandbox og HTML-template i samme fil.
- **Problem:** ét script ejer REST-queries, snapshot, søgeindeks, runtime-VM, side-template, generering og filsystem-cleanup. Genbrug af browser-globals reducerer markup-drift, men gør samtidig buildet afhængigt af implicit global rækkefølge og DOM-frie komponenter.
- **Konsekvens:** små ændringer har stor regressionsflade; en global frontendændring kan bryde build sent, og isolerede unit tests er svære.
- **Anbefalet løsning:** uden frameworkskifte: udtræk datakontrakt/queries, domænemodel, templates og outputmanifest i små ESM-moduler. Bevar én delt renderingskerne og kontrakttest dens browser-/buildbrug. Gør outputmanifestet til input for links/SEO/a11y-checks.
- **Estimeret risiko:** middel; udfør mekanisk i små commits med byte-/DOM-sammenligning.
- **Production deploy:** ja, fordi generatoren ændres, selv hvis output forventes identisk.

### S4 — Erstat den dobbelte CSS-cascade med et lagdelt stylesystem

- **Fil/sted:** `css/style.css` (1.194 linjer/58 KB), bl.a. første `body` ved linje 46 og ny override ved 811; `.site-header` ved 77, 745 og 824; `:focus-visible` ved 68 og 816. Filens sektionskommentarer har også mojibake.
- **Problem:** fase 1-3-styles ligger som flere historiske lag med gentagne globale selectors og sen override. Det virker, men cascade-rækkefølge er en skjult afhængighed.
- **Konsekvens:** en “lokal” CSS-rettelse kan aktivere ældre regler på enkelte sider/breakpoints. Payload og reviewstøj er større end nødvendigt.
- **Anbefalet løsning:** lav en brugsmatrix pr. side, fjern kun beviseligt døde regler, og opdel derefter tokens/base/layout/components/pages/utilities med dokumenteret loadorden. Kør visuelle snapshots ved 375/tablet/desktop og reduced motion for hvert lille commit.
- **Estimeret risiko:** middel til høj; visuelle regressioner er sandsynlige ved stor engangsoprydning.
- **Production deploy:** ja.

### S5 — Indfør browserbaseret regression og dybere accessibility-test

- **Fil/sted:** `tools/check-a11y.mjs:20-102`; ingen browser-E2E-suite.
- **Problem:** a11y-checken er bevidst regex/statisk og verificerer gode basiskontrakter, men ikke computed accessibility tree, fokusorden, historik/back-forward, async statusbeskeder, overflow eller runtime console/network. De egenskaber er hidtil manuelle.
- **Konsekvens:** søge-, filter-, Chart.js- og mobile regressioner kan passere `npm run verify`.
- **Anbefalet løsning:** tilføj en lille hermetisk browsersuite på fixture-snapshot: global combobox, alle NULL-filtertilstande, URL/back/forward/reset, 375 px overflow, tab-rækkefølge, axe/ARIA snapshot, Chart.js-fallback, console og network allowlist. Hold ekstern font/chart-network ude af kerneassertions.
- **Estimeret risiko:** middel; browser-runtime og stabil fixtures kræver vedligeholdelse.
- **Production deploy:** nej for tests alene; senere fixes kan kræve deploy.

### S6 — Versionér statiske assets og indfør CSP trinvist

- **Fil/sted:** `netlify.toml:10-33`; inline scripts i source/template; eksterne Google Fonts og Chart.js.
- **Problem:** CSS/JS/data har stabile filnavne og `max-age=0`, så browseren må revalidere. Globale headers mangler CSP og HSTS. Inline boot-scripts og inline chart-dimensioner gør en streng CSP vanskelig. Chart.js er heldigvis versionpinnet med SRI.
- **Konsekvens:** ekstra netværksrundture, ekstern fontafhængighed og svagere defense in depth ved en fremtidig injectionfejl.
- **Anbefalet løsning:** generér indholdshash/versionmanifest for CSS/JS, brug immutable caching, flyt inline boot til lokale filer/data-attributter, start CSP i Report-Only, og self-host fonts når måling viser værdi. Indfør HSTS kun efter domæne/subdomæne-review.
- **Estimeret risiko:** middel til høj; cache- og CSP-fejl kan gøre hele sitet visuelt eller funktionelt defekt.
- **Production deploy:** ja, i flere målte deploys.

## 4. Kan vente

### W1 — To pagination-implementeringer

- **Fil/sted:** `js/supabase.js:31-70`; `tools/lib/paginated-fetch.mjs`.
- **Problem:** browser og Node har parallelle Range-paginationer.
- **Konsekvens:** potentiel drift i stopbetingelser og Content-Range-tolkning.
- **Anbefalet løsning:** saml først efter modulopdelingen i S3; behold de nuværende stærke repeated-range/mid-error/server-cap-tests indtil da.
- **Estimeret risiko:** middel ved refactor, lav ved at vente.
- **Production deploy:** ja, hvis browserloaderen ændres.

### W2 — Ubrugte indeks skal observeres, ikke straks slettes

- **Fil/sted:** live indeks `deal_investors_investor_id_idx` og `panel_memberships_investor_id_idx`.
- **Problem:** Supabase Performance Advisor markerer dem som unused.
- **Konsekvens:** minimal ekstra write/storage-omkostning i et meget lille datasæt.
- **Anbefalet løsning:** behold dem foreløbig; FK-/delete- og sjældne viewqueries kan bruge dem. Revurder med kendt `pg_stat`-reset og repræsentativ trafik før en migration.
- **Estimeret risiko:** lav ved at vente; middel ved at droppe uden querybevis.
- **Production deploy:** nej; et senere drop er en autoriseret databaseændring.

### W3 — Snapshotstørrelse og simple O(n²)-loops er endnu ikke et problem

- **Fil/sted:** `data/arkiv.json` ca. 176 KB, `data/search-index.json` ca. 88 KB; `tools/tryk.mjs:85-102`.
- **Problem:** nogle indeksberegninger filtrerer hele dealslisten pr. sæson/kategori, og dynamiske sider læser hele arkivet.
- **Konsekvens:** ved 325 virksomheder/329 pitches er omkostningen lille; tidlig optimering vil øge kompleksiteten mere end den sparer.
- **Anbefalet løsning:** mål buildtid, payload og LCP over tid; sæt en dokumenteret tærskel før pre-aggregering eller snapshot-splitting.
- **Estimeret risiko:** lav ved at vente.
- **Production deploy:** nej nu; en senere optimering ja.

### W4 — Revisionsdato og source-date kræver produktdefinition

- **Fil/sted:** `js/supabase.js:154-159`; profilkomponenternes “Senest revideret”.
- **Problem:** frontend-queryen henter event timestamps, men ikke alle source/company/deal revisionsfelter, så betegnelsen kan være smallere end brugeren forventer.
- **Konsekvens:** en ny kilde kan være nyere end den viste eventrevision uden at datoens semantik er tydelig.
- **Anbefalet løsning:** definér først om datoen betyder seneste event, seneste kilde, seneste entitetsændring eller publiceret snapshot. Udvid derefter query/buildkontrakt og metodeforklaring samlet.
- **Estimeret risiko:** lav teknisk, middel redaktionelt.
- **Production deploy:** ja, hvis visningen ændres.

## 5. Anbefalede næste branches i rækkefølge

1. **`agent/ci-without-netlify`** — hermetisk CI-gate og eksplicit live read-only job. Ingen production deploy.
2. **`agent/netlify-credit-guard`** — testet ignore-matrix, docs-only `[skip netlify]`-procedure og deploy-lock-runbook. Højst én bevidst config-deploy.
3. **`agent/supabase-governance-recovery`** — read-only eksport/afstemning af migrations, schema, policies og grants samt plan for isoleret restore. Ingen databaseændring i første branch og ingen production deploy.
4. **`agent/publication-boundary`** — allowlistet `dist/`/`_site`, clean-clone build og konsekvent behandling af genererede registerfiler. Kræver production deploy.
5. **`agent/frontend-reliability-cleanup`** — søge-race, degraded snapshotstatus, delte eventlabels, legacy detailkode og favicon. Kræver production deploy.
6. **`agent/browser-regression-gate`** — fixturebaseret E2E/a11y/runtime-suite. Ingen production deploy for tests alene.
7. **`agent/css-assets-csp`** — gradvis CSS-opdeling, asset-versionering og CSP Report-Only; aldrig som én stor oprydning. Kræver flere kontrollerede production deploys.

Den efterfølgende privilege-hardening bør først udføres som en separat database-migration, når branch 3 har skabt et versionsstyret udgangspunkt, et komplet før/efter-testdesign og eksplicit produktionsautorisation.

## Stærke dele, der bør bevares

- Den statiske Trykpressen-arkitektur, fail-fast build og atomiske Netlify-deploys er et godt match til et redaktionelt dataarkiv.
- Datavalideringen skelner legitime NULL-tilstande fra fejl og mutationstester beløb, ejerandele, CVR, slugs, referencer, kilder og events.
- Link-/SEO-guards beviser fejl ved brudt link, redirectmål, canonical, JSON-LD, sitemapdublet, `Eundefined`, `NaN` og dubleret HTML-id.
- Search-indexet er separat og lazy-loaded; Chart.js er pinned med SRI og grafer har datatabeller som fallback.
- RLS er aktiveret på alle tabeller, viewet bruger invoker-rettigheder, og Security Advisor er grøn.
- Fase 4A holder levende research og redaktionelle artefakter uden for det offentlige repo og udfører ingen produktionsskrivning.
