# Fase 3 · selvstændigt pre-merge-review

**Reviewdato:** 15. juli 2026  
**PR:** #4 · `agent/product-quality-phase-3`  
**Seneste gennemgåede kode- og preview-head:** `8db3cd4f34fe11f9073c1f3aae2da6698c333fab`  
**Preview:** https://deploy-preview-4--velvety-piroshki-d57bf9.netlify.app  
**Vurdering:** **KLAR TIL AFGRÆNSET FABLE-REVIEW**

Handoff-dokumentet lægges oven på den gennemgåede kode-head og ændrer ikke produktionskode eller build-output.

## Områder gennemgået

- Datavalidering: primærnøgler, slugs, CVR, NULL, beløb, ejerandele, aftaleudfald, virksomhedsintegritet, investorrelationer, panelrelationer, events, dato-/præcisionskontrakt, sources og confidence.
- Build og SEO: genererede sider, sideantal, dublerede HTML-id'er, fejlværdier, søgeindeks, links, fragments, redirects, canonical, Open Graph, JSON-LD og sitemap.
- Søgning og filtre: dubletter, destinations-URL'er, danske tegn, CVR, alle filterværdier, NULL som særskilt tilstand, kombinationer, URL-state, tilbage/frem, nulstilling og query-canonical.
- Beregninger: metodekortene, confidence, alle seks analyser, observations- og NULL-tal samt sæsonsammenligningen.
- REST og snapshot: server-cap, inclusive Range, stopbetingelser, gentagne ranges, fejl på en senere side, parallel snapshot-loading, delvise snapshots og risikoen for blandede datakilder.
- Regression: Trykpressen, virksomhedssider, sitemap, runde 7, redirects, centrale fase 1-/2-sider, mobil 375 px, browserkonsol og netværksfejl.

## Tests kørt

### Samlet kvalitetsport

`npm run verify` bestod på den gennemgåede kode-head:

- syntaks: 0 blockers, 0 warnings
- simuleret REST-pagination: 2.300 rækker over 5 sider ved server-cap 500
- parallel snapshot-loading: 3 samtidige kald gav 1 snapshot-request
- delvist snapshot: afvist uden tabelspecifik REST-blanding
- browser-REST: gentaget range og fejl midt i pagination blev afvist
- datavalidering: 0 blockers, 0 warnings
- buildvalidering: 0 blockers, 0 warnings
- interne links og redirects: 0 blockers, 0 warnings
- SEO: 0 blockers, 0 warnings
- statisk tilgængelighed: 0 blockers, 0 warnings
- 326 virksomhedssider, 18 investorprofiler og 11 sæsonsider
- sitemap: 365 URL'er
- søgeindeks: 388 opslag

En efterfølgende `node tools/tryk.mjs --from-snapshot` efterlod fortsat et helt rent arbejdstræ.

### Søgning og filtre

- Søgeindekset havde 0 eksakte dubletter, 0 manglende destinationssider/fragments og 8 bevidste kategori-query-URL'er.
- `Bælg` og `Baelg` gav samme virksomheds- og hændelsesresultater.
- `Hålkær` og `Halkaer` fandt Halkær Ådal.
- CVR `40456023` fandt MuteBox-virksomheden og dens dokumenterede exit som to forskellige entitetstyper.
- Alle værdier i hvert selectfilter og alle par af selectfiltre blev sammenlignet med en uafhængig referenceberegning: 1.893 parvise cases.
- Det fulde kartesiske produkt af de fem nye tilstandsfiltre blev kontrolleret: 756 kombinationer for efterliv, afsnit, søgt beløb, CVR og investorantal.
- NULL-partitioner: afsnit 327/2, søgt beløb 327/2, CVR på pitches 158/171 og investorantal 117/82/130 for én/flere/ingen.
- Efterlivsfiltre på pitches: 18 med efterliv, 311 uden, 3 exit, 5 konkurs/lukning, 4 ændret/ophørt aftale og 7 anden hændelse.
- Preview-journey `season=7&afterlife=yes&cvr=known&investors=multiple` gav 1 pitch. Et ekstra `episode=unknown` gav 0; tilbage og frem gendannede begge tilstande; nulstilling fjernede queryen, fokuserede sæsonfilteret og viste 329 af 329.
- Canonical for alle testede filtervarianter forblev `https://hulensdata.dk/deals.html`.

### Uafhængig efterregning

Snapshot'et gav direkte:

- 329 pitches, heraf 199 registrerede TV-aftaler
- 326 virksomheder, heraf 155 med CVR
- 21 events på 18 virksomheder og 61 sources
- confidence: 47 confirmed, 13 likely og 1 uncertain
- registre: 3 exit-events, 5 konkurs-/lukningsevents og 5 cancelled/renegotiated-events
- virksomheder med mindst én kilde: 34 af 326

De seks analyser blev efterregnet således:

1. Sæsonoptælling: 329 observationer, 0 udeladt.
2. Aftaleandel: 329 boolske udfald, 0 udeladt; S1–4-forbeholdet står ved analysen.
3. Beløb: 327 kendte søgte beløb og 2 NULL; 199 kendte TV-beløb blandt 199 aftaler.
4. Investorrelationer: 199 aftaler; buckets 117 med én, 68 med to, 11 med tre, 1 med fire og 2 med fem investorer.
5. Efterliv: 21 events; eventtyper summerer til 21 uden ukendt type.
6. CVR: 329 virksomhed-sæson-observationer, 158 med CVR og 171 uden dokumenteret CVR.

Sæson 7 mod 9 blev uafhængigt efterregnet til henholdsvis 38/47 pitches, 23/31 aftaler, 61/66 %, TV-beløb 23.953.000/11.150.000 kr., 6/0 efterlivsevents for sæsonernes virksomheder og CVR 17/38 mod 36/47. Previewtabellen viste de samme tal.

### Preview og browser

- Mobil 375 px: ingen dokumentoverflow på forside, pitches, analyser, metode, MuteBox, Jesper Buch, sæson 7 eller de tre registre.
- Brede tabeller scrollede lokalt i navngivne fokusregioner; alle seks grafer holdt sig inden for analyse-kortene.
- Global søgning havde combobox/listbox, navngivne resultatgrupper, options med `tabindex=-1` og korrekt active descendant ved piletast.
- Filtergruppen var navngivet; URL-state, tilbage/frem og reset blev kørt med faktiske browserinteraktioner.
- Canonical og JSON-LD blev kontrolleret på query-varianter samt metode-, analyse-, virksomhed-, investor-, sæson- og registersider.
- Browserkonsol: 0 errors og 0 warnings.
- Netværksdiagnostik på centrale datarejser: 29 observerede svar/events, 0 HTTP-fejl og 0 `loadingFailed`.
- Alle tre deklarerede redirects gav HTTP 301 til eksisterende mål.

## Mutationstests og resultater

Mutationerne kører i en isoleret kopi. Hver ændret fil gendannes i `finally`, indholdet sammenlignes med originalen efter testen, og hele fixture-mappen slettes til sidst.

| Mutation | Forventet værn | Resultat |
|---|---|---|
| Brudt internt link | `LINK_TARGET` | Non-zero exit |
| Manglende canonical | `SEO_CANONICAL` | Non-zero exit |
| Ugyldig JSON-LD | `SEO_JSONLD_PARSE` | Non-zero exit |
| Dubleret sitemap-URL | `SEO_SITEMAP_DUPLICATE` | Non-zero exit |
| `Eundefined` i HTML-output | `BUILD_EUNDEFINED` | Non-zero exit |
| `NaN` i HTML-attribut | `BUILD_NAN` | Non-zero exit |
| Redirect til manglende mål | `REDIRECT_TARGET` | Non-zero exit |
| Dubleret HTML-id | `BUILD_DUPLICATE_ID` | Non-zero exit |

Derudover blev 10 datamutationer stoppet med non-zero exit: dubleret virksomheds-id, orphan source, negativt beløb, ejerandel over 100 %, ikke-boolsk aftaleudfald, ugyldig kalenderdato, ugyldig slug, ugyldigt CVR, uoverensstemmende investorrelationer og event uden synlig kilde. En warning-only mutation af snapshotdatoen beholdt exit code 0. Legitime NULL-tilstande, inklusive en TV-aftale med ukendt beløb/ejerandel, beholdt også exit code 0.

## Fejl fundet og rettet

### `ab8ea84` · REST og snapshot

- Et delvist, men parsebart snapshot kunne tidligere levere nogle tabeller, mens manglende tabeller blev hentet via REST. Det kunne skabe et blandet publiceringsgrundlag. Snapshot'et behandles nu atomisk: en manglende forventet tabel stopper snapshotstien uden tabelspecifik REST-blanding.
- Et gentaget `Content-Range` kunne tidligere blive accepteret som en ny side og give 1.000 rækker med kun 500 unikke. Start, slut og faktisk rækkeantal krydsvalideres nu.
- Fejl midt i pagination afbryder hele kaldet, og browserens små views har fået deterministisk sortering.

### `969e663` · datakontrakt og valideringsværn

- Dublerede HTML-id'er kunne aldrig opdages, fordi id-listen blev konverteret til en `Set` før dubletkontrollen.
- Primærnøgler, investor-/virksomhedsslugs, indlejrede virksomhedsdata og rå/indlejrede investorrelationer manglede krydsvalidering.
- En syntaktisk ISO-dato som `2026-99-99` blev accepteret; kalenderdato og præcisionsplaceholder kontrolleres nu.
- Events uden source var kun warnings, selv om produktet kalder dem dokumenterede og kildebelagte; de er nu blockers.
- `aftale=true` med ukendt TV-beløb var en falsk positiv, selv om metodesiden beskriver beløbsdækning. Den legitime NULL-tilstand er nu tilladt; `aftale=false` med modtaget beløb er fortsat en blocker.
- NULL-teksten skelner nu mellem ukendt og ikke anvendelig værdi.
- En isoleret mutationstest er tilføjet til `npm run verify`.

### `8db3cd4` · analyseformulering

Sæsonsammenligningens efterlivstal var beregnet for virksomhederne fra sæsonen, men labelen kunne læses som events i udsendelsesåret. Label og forbehold forklarer nu populationen og risikoen for, at samme virksomhed tæller i flere sæsoner.

## Resterende usikkerheder

- To-bogstavssøgninger kan stadig være brede, fordi eventbeskrivelser indgår som keywords. Der er ingen eksakte indeksdubletter, men relevansen for meget korte, tvetydige ord er en redaktionel vurdering.
- Offset-pagination har deterministisk sortering og range-kontrol, men kan principielt påvirkes af samtidige databaseændringer mellem sider. Buildvalideringen stopper dublerede primærnøgler; REST-fallbacken er ikke en transaktionel snapshotlæsning.
- Raw REST-fallback fejler atomisk ved en transient fejl, men har ikke retry/backoff. Det er bevidst afgrænset, fordi normal produktion læser det statiske snapshot.
- Supabase-projektets konkrete `max_rows` blev ikke ændret eller aflæst. Testen simulerer cap 500, og paginationen er netop lavet til ikke at stole på et stort klient-`limit`.
- Google Fonts og Chart.js er fortsat eksterne assets. Chart.js har SRI, og tabellerne bevarer analyseindholdet ved scriptfejl.
- Semantik, fysisk tastaturbrug og browserens accessibility-træ er tidligere gennemgået; en egentlig brugerprøve i VoiceOver eller NVDA er fortsat en særskilt aktivitet.

## Præcise kontrolpunkter til Fable

1. Bekræft NULL-kontrakten: `aftale=true` må have ukendt `beloeb_modtaget`/`andel_solgt`, mens `aftale=false` med modtaget beløb fortsat skal blokere.
2. Vurder om event uden source korrekt skal være blocker, og om `year → 01-01` samt `month → dag 01` er den ønskede neutrale sorteringskontrakt.
3. Gennemlæs mutationstesten for uafhængighed: den skal fortsat teste de rigtige scripts i isoleret kopi og altid gendanne fixtures.
4. Gennemgå snapshot-/REST-atomiciteten, gentaget range og fejl midt i pagination; tag eksplicit stilling til den resterende samtidighedsrisiko ved offset-pagination.
5. Lav en kvalitativ relevansprøve på korte danske søgninger og bekræft, at CVR-resultater som både virksomhed og event er ønsket, ikke en dublet.
6. Efterregn sæson 7 mod 9 og kontrollér den nye formulering om efterliv for sæsonens virksomheder samt S1–4-forbeholdet.
7. Stikprøv runde 7-profilerne MuteBox, Stori, Urban-Hald, Maistic og DoDonuts med deres sources/confidence og registrenes 3/5/5 eventtal.

## Konklusion

Der er ikke fundet en kendt kodefejl, som kræver yderligere implementering før næste review. De tilbageværende punkter er afgrænsede kontrakt-, relevans- og brugeroplevelsesvurderinger. Derfor er status **KLAR TIL AFGRÆNSET FABLE-REVIEW**, ikke automatisk merge.
