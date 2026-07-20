# Fase 4 — implementeringsplan

> Historisk planlægningsdokument, 2026-07-16. Planens oprindelige baseline var `main` på `9ba919f`; den er ikke aktuel statistik. Fase 4A er materialiseret som read-only filværktøjer 2026-07-20 og dokumenteret i `docs/phase-4a-operations.md`. Der er fortsat ingen fase 4-produktionsskrivning eller schemaændring.

## Formål og afgrænsning

Fase 4 skal gøre den eksisterende manuelle kuratering mere reproducerbar, sporbar og sikker uden at gøre et nyt redaktionssystem til endnu en redigerbar sandhed. Første leverance bør derfor være en filbaseret forberedelses- og reviewsti:

`research/lead → editorial inbox → schema- og domænevalidering → dry-run/diff → menneskelig godkendelse → eksisterende Supabase-tabeller → npm run verify → backupmanifest`

Fase 4 skal ikke ændre den offentlige produktretning, Trykpressens statiske arkitektur eller de eksisterende domænemodeller. Supabase forbliver den kanoniske redaktionsdatabase; filartefakterne er forslag, kø, audit og bevaring — ikke en parallel produktionsdatabase.

## Kortlægning af det eksisterende

### Redaktionelt workflow

Det dokumenterede workflow ligger primært i den kanoniske Obsidian-vault:

1. Find et lead i presse, register eller aggregator.
2. Efterprøv centrale påstande med primærkilde; aggregatorer er kontrol- og leadkilder.
3. Afgræns fakta til TV-pitch, virksomhed eller efterlivshændelse.
4. Skriv i de eksisterende Supabase-tabeller via MCP/SQL med `sources`, `confidence`, `field_name`, attribution og ærlig datopræcision.
5. Opdatér dokumentation og nøgletal, kør Trykpressen/`npm run verify`, gentryk og tag bevaringseksport.

Runde 7 viser både styrken og svagheden: metoden gav fem events, 19 kilder og stor CVR-fremdrift, men scratchpad, reviewliste, SQL og beslutningsspor er ikke formaliseret som maskinvaliderede artefakter. `updated_at` viser seneste rækkeændring, men ikke hvem, hvorfor, førværdi eller hvilket input der førte til ændringen.

### Backup og restore

- Vaultens `tools/backup.sh` eksporterer otte tabeller og `investor_status`-viewet til `backup/<dato>/` med den offentlige anon-nøgle.
- Ved planlægningen var `backup/2026-07-15/` seneste eksport; de daværende rækketal er historiske og må ikke bruges som aktuel baseline. Den aktuelle read-only inventering af `backup/2026-07-20/` står i `docs/phase-4a-operations.md`.
- Scriptet bruger `limit=10000`, sekventielle kald og kun en `deals > 300`-sanity check. Et stort limit omgår ikke nødvendigvis serverens max-rows.
- Eksporten har ikke hash, byteantal, query, Content-Range, schema-version, samlet succesmarkør eller atomisk publicering. En afbrudt kørsel kan efterlade en mappe, der ligner en backup.
- Restore-proceduren og FK-rækkefølgen er dokumenteret i `bevaring.md`, men der findes ingen automatiseret restore rehearsal. JSON-eksporten er data, ikke en fuld databasebackup af DDL, funktioner, triggers, policies, grants og sekvenser.

### Migrationer og live schema

Der ligger ingen migrationsfiler i kode-repoet. Vaulten har en navneliste og historisk DDL; den autoritative migrationshistorik ligger i Supabase. Read-only katalogafstemning 2026-07-16 fandt 16 migrationer fra `drop_legacy_companies_cvr_skeleton` til `allow_unknown_episode`.

Live `public` består af otte tabeller og viewet `investor_status`. Alle tabeller har RLS. Bekræftede databaseconstraints er:

- PK på alle entiteter og sammensatte PK'er på `deal_investors` og `panel_memberships`.
- FK'er mellem deals/companies, deal_investors/deals+investors, panel_memberships/seasons+investors og company_events/companies; kun event→company er `ON DELETE CASCADE`.
- UNIQUE på company-navn/slug og investor-navn/slug.
- CHECK på kategori, company-status, panelrolle, eventtype, datopræcision, source-entitytype, confidence og `source_url`-scheme.
- `updated_at`-trigger på companies, investors og company_events.
- `sources.entity_id` er bevidst polymorf og har ingen FK.

Vigtige regler findes kun i publiceringsvalideringen: CVR-format og -dubletter, slugformat, beløb/ejerandel, TV-aftalelogik, eventdatoens kalender/præcisionskonvention, event→source, embedded/raw relationsynk og konkurs/lukning mod aktiv status. Fase 4-import må genbruge disse regler og må ikke antage, at databasen alene afviser alle ugyldige kombinationer.

RLS-policyerne er SELECT-only, så anon-skrivning er aktuelt blokeret. Kataloget viser samtidig brede tabel-GRANTs til `anon`/`authenticated`; RLS og GRANT er separate lag. En fremtidig write-policy eller fejl i RLS kan derfor udvide skadefladen. Nye tabeller skal have eksplicitte grants og policies, uanset automatiske `ensure_rls`-triggers og ændrede Supabase-defaults.

### Validering og Trykpressen

`npm run verify` er allerede en stærk publiceringsport:

- syntakscheck af relevante JavaScript- og inline-scripts;
- server-cap-, interval- og midtvejsfejltests for REST-pagination;
- atomisk snapshot-loading uden blanding med REST-fallback;
- datavalidering af relationer, enums, NULL, beløb, ejerandele, slugs, CVR, events og sources;
- deterministisk build fra snapshot;
- build-, link-, redirect-, sitemap-, canonical-, JSON-LD- og statisk a11y-kontrol;
- mutationstests med gendannelse og korrekte non-zero exit codes.

Trykpressen henter ni objekter med stabil sortering og fælles Range-pagination, skriver `data/arkiv.json`, søgeindeks, statiske sider og sitemap. Den bør ikke læse en inbox direkte. Kun et særskilt, godkendt apply-trin må ændre Supabase; derefter arbejder Trykpressen uændret fra de eksisterende tabeller.

## Hvad fase 4 allerede har — og hvad der mangler

| Område | Findes allerede | Mangler til fase 4 |
|---|---|---|
| Redaktionel kontrakt | Hændelser frem for narrativer, confidence, attribution, NULL og datopræcision | Maskinlæsbar inbox, livscyklus, reviewer/approver og afvisningsårsag |
| Datamodel | Normaliseret kerne, events, polymorfe sources, stabile id'er/slugs | Ingen nye tabeller nødvendige for første filbaserede fase |
| Revision | `updated_at`, source-noter, git/vault-changelog | Append-only revisionslog med før/efter-hash, changeset, actor og backupreference |
| Coverage | Build-udledte dækningstal og kendte researchlister | Genereret, prioriteret backlog med regel-id, tilstand og snapshot-hash |
| Backup | Daterede JSON-eksporter, restore-rækkefølge, iCloud-kopi | Manifest, hashes, række-/bytekontrol, komplethed, atomisk markering og restore-test |
| Import | Manuelle SQL/MCP-opdateringer og idempotente CVR-idéer | Streng schema-/domænevalidering, dry-run, diff, preconditions, transaction og replay-beskyttelse |
| Publicering | `npm run verify`, atomisk snapshot/fallback og fail-safe deploy | Knyt en godkendt revision til backup og publiceret snapshot uden at ændre Trykpressen først |
| Credentials | Offentlig anon-læsning; service-rolle/MCP til skrivning | Rolleopdeling, kortlivede credentials, logredaktion og eksplicit manuel godkendelse |

## Genbrug og schemaændringer, der kan undgås

Genbrug følgende produktionsmodeller direkte:

- `companies` som identitet, status, kategori og CVR;
- `deals` + `deal_investors` som TV-øjeblik og investorforhold;
- `company_events` som efterlivshændelser;
- `sources` som fælles evidens- og confidence-lag;
- `seasons`, `investors`, `panel_memberships` og `investor_status` som eksisterende referencegrundlag;
- `data/arkiv.json` som read-only baseline for diff, coverage og fixtures;
- `validate-data.mjs`-regler og `createReport()`-exitkontrakt som valideringsmønster;
- `fetchAllPages()` til enhver fremtidig fuld read-back; aldrig `limit=10000` som garanti.

Inbox, revisionslog, coverage-backlog og backupmanifest kan alle implementeres som versionerede JSON-filer uden Supabase-schemaændring. En revisionslog i databasen er kun relevant, hvis flere redaktører eller samtidige writes senere gør git+artefaktlog utilstrækkelig. En coverage-tabel bør undgås: backloggen kan deterministisk afledes af snapshot og regelsæt. Et backupmanifest hører til selve eksporten, ikke i produktionsdatabasen.

## Forventede filer i en senere implementering

Dette er et change forecast, ikke filer oprettet i denne planlægningsrunde:

- `schemas/editorial-inbox.schema.json`
- `schemas/revision-entry.schema.json` (ét NDJSON-entry)
- `schemas/coverage-backlog.schema.json`
- `schemas/coverage-overlay.schema.json`
- `schemas/backup-manifest.schema.json`
- `tools/validate-editorial.mjs`
- `tools/build-coverage-backlog.mjs`
- `tools/build-backup-manifest.mjs`
- `tools/verify-backup-manifest.mjs`
- `tools/test-phase-4a.mjs`
- `test/fixtures/phase-4/...`
- `package.json` for additive scripts; `verify` udvides først, når scripts er stabile
- vaultens `redaktion.md`, `bevaring.md`, `database.md` og `known-issues.md` efter godkendt implementering

`tools/tryk.mjs`, frontendfiler og Supabase-schema bør ikke ændres i de første commits. Hvis et senere database-auditspor godkendes, skal migrationskilden først få en aftalt, versionsstyret placering; den må ikke fortsat eksistere kun som MCP-historik og vault-noter.

## Implementeringsrækkefølge i små commits

> Revideret 2026-07-16 efter Fable-review (se `docs/phase-4-fable-review.md`): backupmanifest-verifikation rykkes før coverage (i overensstemmelse med risikoregistrets egen anbefaling), revisionsloggen er et selvstændigt 4A-commit, og apply-plan-dokumentet er flyttet til fase 4B.

Hvert commit skal være reviewbart, have egne fixtures, holde `npm run verify` grønt og efterlade eksisterende produktion uændret, indtil apply-trinnet særskilt godkendes.

**Verify-afgrænsning:** `npm run verify` (og dermed Netlify-deploy-gaten) må kun validere *schemas og committede fixtures* — deterministiske artefakter. Levende inbox-/ledger-filer valideres af en separat kommando (fx `verify:editorial`), så en halvfærdig redaktionel kø aldrig kan blokere publicering af sitet.

**Netværksforbud i 4A:** dry-run og alle editorial-værktøjer må ikke importere Supabase-klienten eller læse `SUPABASE_URL`; en guard-test skal bevise nul netværkskald og nul filændringer (fx hash af inputfilerne før/efter kørsel).

1. **`test: add phase 4 contract fixtures`** — materialisér de fire schemas fra data-contract-dokumentet, gyldige minimale fixtures og én ugyldig fixture pr. invarians. Ingen DB-adgang.
2. **`feat: validate editorial inbox files`** — ren filvalidator med størrelse/dybdegrænse, `additionalProperties: false`, duplikatkontrol og stabile fejlkoder. Kun read-only.
**Fase 4A (filbaseret, ingen credentials, ingen produktionsskrivning):**

3. **`feat: compare inbox proposals with snapshot`** — semantisk dry-run mod `data/arkiv.json`: target-resolution (inkl. `local_ref` for inserts), preconditions mod baseline, before/after-diff i kanonisk sortering (entitet → id → felt) og konfliktrapport (samme felt rørt af to operationer = fejl). Ingen SQL-generering eller skrivning endnu.
4. **`feat: verify backup manifests against existing exports`** — manifest + verifikation af den eksisterende `backup/<dato>/`-eksport (hash, bytes, rækker, komplethed): 100 % filbaseret. En ny eksportkørsel med Range-pagination, tempmappe og atomisk rename/`complete` kan følge som separat commit (anon read-only netværk); den gamle `backup.sh` bevares, til paritet er bevist.
5. **`feat: generate coverage backlog from snapshot`** — deterministiske regel-id'er (regel + database-id) for manglende CVR, kategori, kilder og kendte NULL-felter + overlay-mekanismen til manuel status. Fravær skal være `unknown`, aldrig automatisk negativt udfald. Ingen netværkstjek af kilde-URL'er i generatoren (determinisme).
6. **`feat: add editorial revisions ledger (NDJSON)`** — append-only ledger for forslag/valideret/afvist/planlagt med prefix-verifikation; ingen `applied`-entries kan opstå, før et apply-trin findes.
7. **`test: add phase 4 mutation guards`** — korruption, afkortning, path traversal, symlinks, `__proto__`, dubletter, stale precondition, same-field-konflikt, orphan source, ukendt `local_ref`, slugændring uden `redirect_from`, delvis backup og hashfejl; alle mutationer i temp-fixtures, som altid gendannes.
8. **`docs: document phase 4 editorial operations`** — opdatér vaultens workflow-, bevarings- og databasenoter efter godkendt implementering.

**Fase 4B (kræver særskilt godkendelse; bygges ikke i 4A):**

9. **`feat: emit reviewed apply plan`** — deterministisk, menneskeligt reviewbart operationsdokument fra en godkendt inbox; ingen eksekverbar SQL og stadig ingen skrivning.
10. **`feat: apply approved editorial changes transactionally`** — kun efter særskilt produktbeslutning og credential-design. Én transaktion, preconditions, rollback ved enhver fejl, read-back, revisionspost og backupreference. Hvis behovet kan dækkes sikkert med manuel MCP/SQL, kan dette trin helt undgås. Gennemført restore rehearsal i isoleret miljø er en forudsætning.

## Test-fixtures og mutationstests

Præcise fixtures foreslås under `test/fixtures/phase-4/`:

- `inbox/minimal-company-field.json`: dokumenteret CVR på eksisterende company med `expected_before: null`.
- `inbox/event-with-two-sources.json`: månedspræcis exit med to sources og neutral sorteringsdag.
- `inbox/no-deal-null-state.json`: legitim NULL for modtaget beløb/andel og ingen investorer.
- `inbox/multi-investor-deal.json`: én deal med flere relationer uden beløbsdobbelttælling.
- `inbox/unknown-episode.json`: legitimt ukendt afsnit.
- `inbox/stale-company-update.json`: korrekt target, forkert before-hash.
- `snapshot/minimal.json`: lille syntetisk regressionsfixture; aktuelle produktionstal må altid afledes af det seneste snapshot.
- `backup/complete-small/`: alle otte tabeller + view, manifest og hashes.
- `backup/partial-missing-sources/`, `backup/truncated-deals/` og `backup/tampered-hash/`.

Mutationerne skal bevise non-zero exit og stabile fejlkoder for: ukendt topfelt, for stor fil, for dyb JSON, duplicate inbox-id, duplicate operation-id, path traversal i artifact-path, ugyldig UUID/dato/hash, ukendt table/field, type coercion (`"155"` som tal), stale baseline, slug/CVR-kollision, ugyldigt event/source-par, source til manglende target, NULL→værdi uden evidens, write uden approver, hash mismatch, forkert row count, manglende tabel/view, backup markeret complete før alle filer, og midtvejs REST-fejl. Positive mutationer skal bevise, at legitime NULL-tilstande, source uden URL og `other`-event ikke afvises.

## Filbaseret, credentials og manuel handling

Kan implementeres uden Supabase-skrivning:

- alle fire JSON-kontrakter og validators;
- inbox-triage, deduplikering og reviewstatus;
- coverage-backlog fra snapshot;
- dry-run, diff, precondition- og referencetjek;
- revisionslog for forslag, afvisninger og planlagte ændringer;
- backupmanifest-verifikation på eksisterende eksport;
- generering af et menneskeligt apply-plan-dokument.

Kræver netværk, credentials eller manuel handling:

- frisk backup fra Supabase kræver mindst read-adgang; service-role er ikke nødvendig for offentlige tabeller, men fuld schema/grants/policies-backup kræver privilegeret read-adgang;
- produktionswrites kræver MCP/service-role og eksplicit godkendelse; credentials må kun komme fra miljø/connector, aldrig inbox, manifest, git eller log;
- officiel CVR/Virk-adgang kræver Alexanders MitID/ansøgning;
- Netlify build hook og deploy rollback kræver manuel Netlify-adgang;
- migration, nye grants/policies eller database-auditspor kræver særskilt schema-review, migration, advisor-kørsel og restore-plan;
- faktisk restore rehearsal kræver et isoleret projekt eller en godkendt databasebranch og dermed mulig omkostning/manual godkendelse.

## Definition of done for første implementeringsslice

Efter reset bør første slice være commits 1–3: schemas, fixtures, filvalidator og snapshot-dry-run. Den er færdig, når den er deterministisk, ikke kan skrive eller generere eksekverbar SQL, afviser stale/ukendte targets, accepterer dokumenterede NULL-tilstande, bruger stabile fejlkoder og er koblet til `npm run verify` uden at ændre Trykpressens output.
