# Fase 3 — produkt- og kvalitetsaudit

> Dateret 2026-07-15. Baseline: `main` på merge-commit `5921ced`. Tal er udledt af `data/arkiv.json` fra 2026-07-15 og skal genberegnes ved hvert build.

## Produktet i dag

Hulens Data er efter fase 1 og 2 et sammenhængende, statisk dataarkiv. Den godkendte visuelle retning fungerer og skal ikke ændres. Fase 3 skal gøre de eksisterende svar lettere at finde, forklare beregninger og dækning bedre og gøre fejl reproducerbart synlige før publicering.

Det aktuelle snapshot rummer 329 pitches, 199 registrerede TV-aftaler, 326 virksomheder, 18 investorer, 11 sæsoner, 21 efterlivshændelser, 61 kilder og 155 virksomheder med CVR. De tal er auditbaseline, ikke nye hardcodede produkttekster.

## Offentlige sidetyper

| Sidetype | Primært svar | Data og interaktion |
|---|---|---|
| Forside `/` | Hvad rummer arkivet, og hvor starter jeg? | Global søgning, dynamiske snapshot-tal, registre, seneste events, sæsonindgange og kort metodeforklaring |
| Virksomhedsregister `/companies.html` | Find en virksomhed | Navn, sæson, status og kategori; alfabetnavigation |
| Virksomhedsprofil `/virksomheder/<slug>/` | Hvad skete på TV og bagefter? | Identitet, alle pitches, TV-vilkår, events, kilder, confidence, relationer og registre |
| Pitchoversigt `/deals.html` | Hvilke pitches og TV-aftaler er registreret? | Sæson, investor, udfald, kategori, status, fritekst og sortering med URL-state |
| Investorregister `/investors.html` | Hvem har siddet i panelet? | Aktiv/gæst/tidligere og registrerede TV-aftaler |
| Investorprofil `/loever/<slug>/` | Hvad er investorens dokumenterede TV-historik? | Panelperiode, registrerede aftaler, sæsonfordeling og medinvestorer |
| Sæsonprofil `/saesoner/<n>/` | Hvad er registreret i en sæson? | Pitches, TV-aftaler, panel og efterliv; eksplicit S1–4-forbehold |
| Arkivforside `/arkiv/` | Hvilke tværgående efterlivsregistre findes? | Indgang til tre registre med build-genererede tal |
| Registre `/arkiv/<register>/` | Hvilke exits, konkurser/lukninger eller ændrede aftaler er dokumenteret? | Eventtype, datopræcision, TV-kontekst, kilder og confidence |
| Analyser `/charts.html` | Hvilke deskriptive mønstre findes i datasættet? | Fire canvas-grafer med spørgsmål og korte begrænsninger |
| 404 | Hvordan kommer brugeren videre fra et dødt link? | Søgning og direkte arkivlinks; `noindex` |

Der findes endnu ingen selvstændig offentlig metode- og datadækningsside. Forsidens metodeafsnit er et nyttigt resumé, men kan ikke bære definitioner, dækningsberegninger og rettelsesprocedure alene.

## Primære brugerrejser

1. Søg efter en kendt virksomhed → læs TV-forløb → læs dokumenteret efterliv → efterprøv kilder.
2. Søg efter en investor → se panelhistorik og registrerede TV-aftaler → gå videre til virksomheder eller medinvestorer.
3. Filtrér pitches → sammenlign udfald, sæsoner eller datastatus → åbn virksomhedsprofilen.
4. Gå fra sæson → pitch → virksomhed → event/register.
5. Gå fra et tematisk register → konkret hændelse → hele virksomhedssagen.
6. Gå fra en analyse → forstå en tendens → kontrollér den underliggende tabel eller metode.

Krydslinks mellem virksomhed, investor, sæson og register er stærke. Den største opdagelsesbarriere er, at global søgning kun kender virksomheder og investorer, mens kategorier, sæsoner, registre, CVR og dokumenterede hændelser kræver forhåndskendskab til navigationen.

## Filtre, søgning og tomme tilstande

### Nuværende filtre

- Virksomhedsregister: sæson, status, kategori og navn.
- Pitchoversigt: sæson, investor, TV-udfald, kategori, virksomhedsstatus og navn.
- Sortering: virksomhed, sæson, udfald, beløb, andele, kategori og status.

Filtrene kan kombineres, og pitchfiltrene afspejles i URL'en. Pitchsiden bruger dog `replaceState` ved alle ændringer og lytter ikke til `popstate`; browserens tilbage-/fremknap kan derfor ikke bruges som en pålidelig filterhistorik. Virksomhedsfiltrene har ingen URL-state.

Mangler med høj produktværdi og korrekt datagrundlag:

- dokumenteret efterliv og specifik hændelsesgruppe,
- kendt/ukendt afsnit,
- kendt/ukendt søgt beløb,
- dokumenteret CVR,
- én eller flere investorer,
- tydelig nulstilling og aktivt filterresumé.

Tomt søgeresultat findes, men forklarer ikke hvilke filtre der er aktive. Global søgning kræver mindst to tegn, viser højst otte blandede resultater og bruger simpel delstrengsmatch; det kan give støj for korte eller indlejrede ord.

## Datatyper, NULL og kilder

De offentlige datatyper er: pitch/TV-aftale, virksomhed, investor, panelmedlemskab, sæson, efterlivshændelse og kilde. Efterlivstyperne er generiske og rendres uden virksomhedsspecifik kode.

Ukendt data vises allerede eksplicit på virksomhedssider, sæsonsider og pitchtabellen: afsnit, søgt beløb, andele, kategori, status og CVR. Tomme efterlivs- og kildetilstande forklarer, at fravær af dokumentation ikke er bevis for, at intet er sket.

Kilder vises på virksomhedshændelser, virksomhedsfakta, dealfelter og registre. Confidence vises som bekræftet, sandsynlig eller usikker. Kilder er mindre synlige på forsiden, analyserne og sæsonens dækningsforklaring. Der findes ingen samlet offentlig forklaring af confidence, datopræcision, aggregatorer som leads eller kriteriet for ikke at publicere en oplysning.

## Statistik, beregninger og misforståelsesrisici

TV-aftaler kan stadig forveksles med realiserede investeringer, især når summer kaldes investeringer eller vises uden nærliggende metodeforklaring. Fase 2 har rettet hovedteksterne, men:

- forsiden bruger labelen “TV-investeringer”, mens resten af produktet foretrækker “registreret TV-beløb”,
- grafer viser ikke antal observationer, udeladte NULL-værdier eller tabellen bag canvas,
- investorens pitchtal er pitches i panelsæsonernes datasæt, ikke dokumenteret personlig tilstedeværelse ved hvert pitch,
- aftaleandel for sæson 1–4 er misvisende på grund af ufuldstændig registrering af afviste pitches,
- antal efterlivshændelser er dokumentationsdækning, ikke en måling af succes eller fiasko,
- CVR-dækning kan ikke uden videre læses som komplet virksomhedsidentifikation pr. sæson, fordi virksomheder kan optræde flere gange.

Analyserne er deskriptive, men de mangler reproducerbar metode ved hvert resultat. Canvas uden en datatabel gør desuden analysen mindre tilgængelig og sværere at efterprøve.

## Navigation og overlap

- Forsiden har både søgning, destinationskort og sæsonindgange; det er passende, men metodefragmentet overlapper en nødvendig selvstændig metodeside.
- Virksomhedsregisteret og global søgning overlapper i navnesøgning. Registeret er bedst til bred browsing; global søgning bør være hurtig genvej på tværs af typer.
- Sæsonsider og pitchoversigten viser samme pitches med forskellig kontekst. Det er et nyttigt overlap, hvis filterlinks og metodebegreber forbliver ens.
- Investorprofiler og analyser opsummerer aftaler. De bør linke til filtreret pitchgrundlag i stedet for at ligne uafhængige sandheder.
- “Sæsoner” i hovednavigationen peger på et anker på forsiden, mens øvrige punkter har egne topniveau-sider. Det er funktionelt, men mindre forudsigeligt.

## Runtime, build og performance

Normal produktion læser ét statisk snapshot på cirka 163 KiB; der er ingen normale Supabase-kald. JavaScript er cirka 49 KiB og CSS cirka 53 KiB før komprimering. Alle statiske profilsider indlæser dog snapshot'et igen alene for at vise to header-tal. Det er unødvendigt, fordi tallene kendes ved build.

Eksterne runtime-afhængigheder:

- Google Fonts på alle sider (`display=swap`, men uden preconnect),
- Chart.js 4.4.1 fra cdnjs på analysesiden, p.t. uden SRI.

Trykpressen henter tabeller med store `limit`-værdier. Det er ikke en garanti mod Supabase-projektets servermæssige max-rows og kan ved vækst give et tilsyneladende gyldigt, men afkortet snapshot. Der findes ingen generisk pagination eller rækkeantal-verifikation ud over `deals.length < 300`.

Store tabeller bruger intern scrolling og er acceptable ved nuværende 329 rækker. Global søgning bør bruge et lille build-genereret indeks frem for at gøre det fulde snapshot til søgekontrakt. Cachepolitikken er ikke eksplicit dokumenteret i `netlify.toml`.

## Kvalitets- og driftsrisici

1. Der findes ingen samlet automatiseret datavalidering, buildvalidering, linkkontrol eller SEO-kontrol.
2. Polymorfe kilder har ingen database-FK og valideres ikke før publicering.
3. Trykpressen kan miste rækker ved serverbegrænset REST-svar.
4. Filterhistorik og query-state er ikke fuldt browserrobust.
5. Query-URL'er canonicaliserer i rå HTML til grundsiden, men strategien er ikke dokumenteret eller testet.
6. JSON-LD, canonical, sitemap, redirects og interne links kontrolleres manuelt og kan regressere lydløst.
7. Statiske sider henter mere data end nødvendigt for headerstatistik.
8. CSS indeholder stadig historiske, nu ubrugte blokke før det gældende tokenlag. Oprydning skal være forbrugsbaseret og må ikke ændre den godkendte visuelle retning.
9. Vaultens status-, roadmap-, SEO- og deploymenttekster beskriver flere steder fase 2 som draft eller den gamle runtime. De skal ajourføres uden at slette historikken.

## Prioriteret implementeringsplan

### P0 — publiceringssikkerhed

1. Indfør validering af relationer, værdier, slugs, CVR, events, kilder, confidence og statuskonflikter.
2. Indfør build-, link- og SEO-kontrol med blocker-exitkode og præcise fejlsteder.
3. Saml kontrollen i `npm run verify` og gør den egnet til Netlify-build.
4. Erstat store REST-limits med generisk, korrekt pagination og verificér forventede tabeller.

### P1 — findbarhed og forståelse

5. Generér et normaliseret søgeindeks fra snapshot'et med virksomheder, investorer, sæsoner, kategorier, registre, CVR og dokumenterede hændelser.
6. Udvid pitchfiltrene med efterliv, datakendthed, CVR og investorantal; gør URL-state og tilbage/frem reproducerbar.
7. Publicér `/metode/` med dynamisk datadækning, definitioner, kildehierarki, NULL-regler og rettelsesprocedure.

### P2 — analyse og sammenligning

8. Vis observationstal, udeladte værdier, NULL-andel og datatabel ved hver analyse.
9. Tilføj en enkel sæsonsammenligning med deskriptive mål og dækningsforbehold.
10. Pin Chart.js med SRI eller dokumentér et bedre begrundet alternativ.

### P3 — robusthed og vedligeholdelse

11. Fjern snapshot-request fra statiske sider, når headerstatistik kan trykkes direkte.
12. Tilføj cache-/sikkerhedsheaders, font-preconnect og robuste sekundære fejltilstande.
13. Udfør en forbrugsbaseret CSS-oprydning og dokumentér det, der bevidst bevares.
14. Opdatér repository-dokumentation og den kanoniske vault med drift, tests, begrænsninger og næste fase.

Auditten er en implementeringskontrakt for fase 3. Den ændrer ikke produktidentiteten, datamodellen eller den redaktionelle metode.
