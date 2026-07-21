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
- Databasefundamentet er dokumenteret i [`docs/database-migrations-recovery.md`](database-migrations-recovery.md) og restore-flowet i [`docs/recovery-restore-runbook.md`](recovery-restore-runbook.md). Indtil en replay-testet baseline findes, må der ikke oprettes tomme historiske migrationsfiler, køres `db push` eller afstemmes migrationshistorik mod produktion. `db pull` og `migration repair` tæller som production-writes, når de ændrer den eksterne migrationshistorik, og kræver særskilt godkendelse.
- Før senere databasearbejde køres `npm run check:database-foundation` og `npm run test:database-foundation`. Credentials, rå dumps og private restore-artefakter må aldrig lægges i repository'et.
- Genererede mapper og filer håndteres efter `.gitignore` og Trykpressens eksisterende proces. Commit ikke genererede artefakter, der normalt bygges ved deploy.
- REST-fallback og Trykpressens datakald skal bruge den fælles, generiske `Range`-pagination. Et stort `limit` er ikke en garanti mod Supabase-projektets servermæssige max-rows. Normal produktion læser fortsat det statiske snapshot; paginationen beskytter build og fallback mod tavs afkortning.

## Verifikation før review

- Kør `npm run verify`. Den samlede publiceringskontrol omfatter JavaScript-syntaks, simuleret REST-pagination, dataintegritet, deterministisk snapshot-build, interne links, redirects, sitemap, canonical URLs, strukturerede data og statiske tilgængelighedsregler.
- Test desktop og mobil, tastaturnavigation, global søgning, fokus, reduceret bevægelse, tomme/ukendte tilstande, 404, interne links og browserkonsol.
- Test virksomhed med og uden aftale, ukendt afsnit, flere investorer, efterliv og kilder samt profil uden efterliv.
- En ændring er ikke klar til merge, før build og relevante tests er grønne, og en anden part har reviewet den.
