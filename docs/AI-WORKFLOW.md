# Fælles AI-workflow

Denne fil er den fælles arbejdsregel for Codex, Claude og andre implementører i hulensdata-repository'et. Læs den før ændringer.

## Dokumentationshierarki

1. Projektets kanoniske produkt-, data- og arkitekturbeslutninger ligger i den eksisterende Obsidian-vault (`Projekter/_Aktive/Hulensdata/`).
2. Denne fil er den fælles arbejds- og sikkerhedsprocedure for AI-agenter.
3. `AGENTS.md` og `CLAUDE.md` peger på begge lag og må ikke gøre workflow-filen til erstatning for projektets kanoniske dokumentation.
4. Ved reel konflikt mellem en produktbeslutning og agentworkflowet skal konflikten synliggøres og afklares. Den må ikke stiltiende overskrives.

## Dataprincipper

- Dokumentér hændelser, ikke narrativer. Beskriv daterbare fakta, kildebelagte citater og tydeligt attribuerede partsudsagn.
- Brug `NULL` frem for gæt. Ukendte afsnit, datoer, beløb, ejerandele og statusser skal forblive ukendte og vises som "Ikke dokumenteret" eller "Ukendt".
- Fjern eller skjul aldrig eksisterende kilder. Nye centrale oplysninger kræver en synlig kilde og korrekt confidence-markering.
- Der må kun være én redigerbar sandhed pr. domænefaktum. TV-pitch og TV-aftale bor i `deals`; virksomhedsfakta bor i `companies`; efterliv bor i `company_events`.
- Projektet er uofficielt og må ikke antyde tilknytning til DR.
- Nøgletal udledes fra den aktuelle database, `data/arkiv.json` eller nyeste build-output. Kopiér ikke tal fra gamle noter eller prompts.

## Git, review og aflevering

- Arbejd aldrig direkte på `main`. Opdatér `main` med `git pull --ff-only`, og opret derefter en særskilt branch.
- Lav små, logiske commits. Implementøren må ikke godkende eller merge sit eget arbejde.
- Push arbejdsbranchen og aflever via en draft pull request mod `main` med ændringer, beslutninger, tests, begrænsninger og konkrete reviewpunkter.
- Bevar brugerens eksisterende ændringer. Undgå destruktive Git-kommandoer.

## Kode, URL'er og database

- Bevar vanilla HTML/CSS/JavaScript, den statiske Trykpresse og den CDN-baserede læsesti, medmindre en dokumenteret beslutning ændrer arkitekturen.
- Render-komponenter skal være DOM-frie HTML-streng-funktioner, ikke mutere input og escape al database-tekst med `esc()`.
- Gamle URL'er skal fortsat virke eller have redirects. Eksisterende canonical URLs må ikke brydes tavst.
- Supabase-ændringer kræver en dokumenteret migration, før-/efterkontrol og et reelt behov. Ingen destruktive produktionsændringer uden eksplicit godkendelse.
- Genererede mapper og filer håndteres efter `.gitignore` og Trykpressens eksisterende proces. Commit ikke genererede artefakter, der normalt bygges ved deploy.
- REST-forespørgslens `limit=10000` på `sources` er et klientønske, ikke en garanti for at omgå Supabase-projektets servermæssige max-rows. Normal produktion læser det statiske snapshot, og datasættet har cirka 61 kilder, så fase 2 indfører ikke pagination. Pagination skal planlægges, før kildemængden nærmer sig projektets servergrænse.

## Verifikation før review

- Kør JavaScript-syntakskontrol og repository'ets eksisterende tests.
- Kør `node tools/tryk.mjs`, og kontrollér sitemap, centrale genererede sider, metadata, canonical URLs og strukturerede data.
- Test desktop og mobil, tastaturnavigation, global søgning, fokus, reduceret bevægelse, tomme/ukendte tilstande, 404, interne links og browserkonsol.
- Test virksomhed med og uden aftale, ukendt afsnit, flere investorer, efterliv og kilder samt profil uden efterliv.
- En ændring er ikke klar til merge, før build og relevante tests er grønne, og en anden part har reviewet den.
