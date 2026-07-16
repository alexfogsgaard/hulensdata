# Fase 4 — risikoregister

> Read-only vurdering, 2026-07-16. Ingen risici er “løst” af dette dokument; de er gates for en senere implementering.
>
> **Revideret 2026-07-16 efter Fable-review:** R29–R30 tilføjet; grants-påstanden i R11 er uafhængigt verificeret mod livekataloget (anon/authenticated har i dag fulde tabelprivilegier på alle ni objekter — kun SELECT-only RLS-policies beskytter mod skrivning).

## Risikoskala og beslutningsregel

Sandsynlighed og konsekvens vurderes som lav/middel/høj. En høj konsekvens kræver en eksplicit kontrol og bevisende test før produktionsskrivning. Ingen import må skrive, hvis baseline, backup, approver, target-resolution eller read-back er uklar.

| ID | Risiko og aktuel evidens | S/K | Krævet kontrol og test | Gate/ejer |
|---|---|---|---|---|
| R1 | **Inbox bliver en parallel sandhed.** Supabase er kanonisk, men filforslag kan leve videre efter apply. | M/H | Inbox indeholder kun operations+preconditions; status `applied` kræver revision og after-hash. Coverage regenereres. | Arkitektur-review |
| R2 | **Stale write/TOCTOU.** Snapshot kan være ældre end live DB mellem review og apply. | H/H | Hash baseline og hvert `expected_before`; genlæs i samme transaktion og abortér ved mismatch. Mutation: stale value skal give non-zero. | Apply-gate |
| R3 | **Type coercion og NULL-overskrivning.** Strenge kan ligne tal; ukendt kan blive tom streng/0/false. | H/H | Ingen coercion; field allowlist med eksakte typer; særskilte `clear`, `unknown` og `not_applicable`. Positive NULL-fixtures. | Validator |
| R4 | **Ugyldigt eller fjendtligt input.** Stor/dyb JSON, prototypefelter, ukendte keys eller path traversal kan ramme værktøjer og backupstier. | M/H | Byte-/dybde-/itemgrænser, `additionalProperties:false`, egne plain objects/maps, relative paths under fast root, ingen shell interpolation. Mutationer for `__proto__`, `../`, symlink og JSON-bombe. | Validator/security |
| R5 | **Dubletter og ikke-idempotent retry.** Samme operation kan indsætte event/source to gange efter timeout. | M/H | Globale inbox-/operation-/revision-id'er, applied-ledger, uniqueness-check og read-back. Retry skal give no-op eller konflikt, aldrig ny række. | Apply-gate |
| R6 | **Polymorfe sources bliver forældreløse.** `sources.entity_id` har ingen FK; build-validatoren er nu eneste generiske værn. | H/H | Resolve target før write; event+source i samme transaktion; fuld `validate-data` på read-back; orphan-mutation. Overvej ikke schemaændring før faktisk behov. | Data-review |
| R7 | **Cascade-sletning.** `company_events.company_id` bruger `ON DELETE CASCADE`; en company-delete kan skjule events, mens sources stadig kan blive orphaned. | L/H | Fase 4 v1 tillader ingen DELETE af companies/events/sources. Unlink/delete kræver særskilt godkendelse og dependency-preview. | Produktbeslutning |
| R8 | **Beløb/ejerandel og relationer mister semantik.** TV-beløb kan dobbelttælles pr. investor, og aftale/NULL kan modsige hinanden. | M/H | Genbrug validate-data-regler, multi-investor-fixture og no-deal-fixture; ingen afledte valuations lagres. | Domænereview |
| R9 | **Eventdato eller fortolkning overdriver kilden.** Neutral sorteringsdag kan fejlagtigt blive præsenteret som kendt dag. | M/H | `date_precision`+dato valideres samlet; årsdata bruger 01-01 og månedsdata dag 01; redaktionel review efter `redaktion.md`. | Redaktion |
| R10 | **CVR/navnematch rammer navnebror.** Eksakte navnematches har allerede givet falske kandidater. | H/H | Branche/identitet og primær dokumentation; CVR unique-check; medium/low må aldrig auto-apply. Fixture med navnebror og dublet-CVR. | Alexander/redaktion |
| R11 | **RLS forveksles med grants.** Live tabeller har SELECT-only policies, men brede anon/authenticated grants. En fremtidig write-policy eller RLS-fejl kan aktivere bredere adgang end tænkt. | M/H | Eksplicit revoke/grant-design ved enhver ny tabel/policy; negative anon-write-tests; Security Advisor efter DDL. RLS og privileges dokumenteres separat. | DB/schema-review |
| R12 | **Nye Supabase-defaults antages at være sikkerhed.** Nye projekter/tabeller kan have ændret Data API-grantadfærd, og `ensure_rls` aktiverer kun RLS — det definerer ikke korrekt policy/privilege. | M/H | Migrationer skal erklære RLS, policies og grants eksplicit. Følg aktuelle officielle [RLS-dokumentation](https://supabase.com/docs/guides/database/postgres/row-level-security) og [Data API hardening](https://supabase.com/docs/guides/database/hardening-data-api). | DB/schema-review |
| R13 | **Service-role eller anden secret lækker.** Nøglen kan ende i inbox, manifest, logs, stack traces, git eller shellhistorik. | M/H | Connector/env-only, secret scanning, redigerede fejl, aldrig credentials i artefakter. Service-role bruges ikke til filbaseret fase. | Credential-gate |
| R14 | **Backup er tavst afkortet.** Det nuværende script bruger `limit=10000`; server-cap kan returnere færre rækker med successtatus. | M/H | Range-pagination, stable order, exact count/Content-Range, per-table minimum/paritet og hash. Server-cap/midtvejsfejl-fixtures. | Backup-gate |
| R15 | **Delvis backup ligner en hel.** Scriptet skriver direkte i datomappen og sanity-checker kun deals. | H/H | Tempmappe, alle objekter obligatoriske, manifest `in_progress→complete` efter verifikation, atomisk rename. Manglende sources/view skal fejle. | Backup-gate |
| R16 | **“Backup” mangler schema og adgangskontrol.** JSON+navneliste kan ikke alene genskabe DDL, triggers, functions, policies, grants, view security eller sequences. | H/H | Manifest skelner dataeksport fra fuld recovery set; versionsstyret DDL/migrationer, policy/grant dump og restore rehearsal. | Bevaringsbeslutning |
| R17 | **Backup korruption eller cloud-synk er uopdaget.** iCloud er en kopi, men ikke integritetsbevis eller nødvendigvis uafhængig retention. | M/H | SHA-256, periodisk re-verifikation, mindst én separat immutable/offline kopi og retentionbeslutning. | Alexander |
| R18 | **Persondata/secrets i backup.** Fremtidige inboxes kan indeholde actor-id, noter eller rå research, som ikke bør være offentligt eller ligge ukrypteret. | M/H | Dataminimering, ingen auth/secrets, klassifikation og evt. krypteret privat backup; publiceringssnapshot holdes adskilt. | Privacy-review |
| R19 | **Rollback er kun delvis.** Netlify/code/data rollback er adskilt; DB rollback kan kræve at bevare identity-id'er og relationer. | M/H | Pre-write backup-id, én transaktion, inverse-plan som ny revision, read-back og restore rehearsal i isoleret miljø. Ingen destruktiv auto-rollback. | Operations-gate |
| R20 | **Migration drift.** Repoet har ingen migrationsfiler; vaultlisten har historiske placeholder-versioner, mens live Supabase har 16 eksakte migrationer. | H/H | Før næste DDL: vælg én versionsstyret migrationskilde, eksportér/afstem live head og gør driftcheck obligatorisk. | Arkitekturbeslutning |
| R21 | **Én produktionsdatabase uden staging.** Testwrites kan ramme rigtige data; at bygge staging er eksplicit uden for denne plan. | H/H | Første fase er 100 % filbaseret. Fremtidig apply testes i temp-fixtures; faktisk restore/apply kræver godkendt isoleret Supabase branch/projekt og omkostningsaccept. | Alexander |
| R22 | **Delvis apply eller netværksfejl.** Flere REST/MCP-writes kan efterlade company/event/source inkonsistent. | M/H | Én databasefunktion/transaktion eller manuel enkelttransaktion; ingen client-side batch writes; abort ved enhver fejl; read-back før revision `applied`. | Apply-gate |
| R23 | **Trykpressen publicerer en forkert, men strukturelt gyldig ændring.** `verify` beviser kontrakter, ikke kildens sandhed. | M/H | Menneskelig kilde- og tekstreview forbliver obligatorisk; confidence/attribution; diff af berørte profiler og registre. | Redaktion |
| R24 | **Coverage-backlog overfortolker fravær.** Ingen event/source kan fejlagtigt blive “ingen efterliv”. | H/M | Generator bruger `unknown`; resolution kræver revision/evidence eller eksplicit `not_applicable`. Mutation for company uden event. | Coverage-review |
| R25 | **Revisionslog kan omskrives.** JSON Schema kan ikke håndhæve append-only, og actor-id er ikke i sig selv autentificeret. | M/H | Prefix-verifikation, hash-chain eller signeret commit senere, protected review og separat database-audit hvis flerbrugerbehov opstår. Ingen stærkere auditpåstand end evidensen bærer. | Governance |
| R26 | **Backup/restore af view eller generated/identity-felter fejler.** `investor_status` skal genskabes, `aftale` er generated, identity-id'er skal bevares. | M/H | Restore-order og column allowlists; indsæt ikke view/generated felt; `OVERRIDING SYSTEM VALUE` kun i kontrolleret restore; sekvensafstemning efter restore. | Restore rehearsal |
| R27 | **Snapshot og live data blandes.** Fase 3 beskytter browserfallback, men nye værktøjer kan blande en delvis filbaseline med REST. | M/H | Ét input-mode pr. kørsel; snapshot er atomisk og komplet eller hele run bruger frisk REST-baseline; baseline-hash i alle outputs. | Tooling |
| R28 | **Revision af publicerede noter eksponerer følsomt researchmateriale.** Source-note og event-description er offentlige via snapshot/profiler. | M/M | Inbox kan have privat reviewnote, men apply-allowlist må kun overføre eksplicit publicerbare felter. Fixture med intern note. | Redaktion/privacy |
| R29 | **Redaktionel kø blokerer publicering.** Netlify kører `npm run verify` som build-kommando; hvis levende inbox-/ledger-filer valideres dér, kan en halvfærdig redaktionel fil vælte site-deploys. | M/H | Verify validerer kun schemas + committede fixtures; levende artefakter valideres af separat `verify:editorial`. Test: en bevidst ugyldig inbox-fil uden for fixtures må ikke ændre verify-exitcode. | Tooling |
| R30 | **Editorial-artefakter i offentligt repo.** Inbox, ledger og overlay kan rumme intern research, afviste hypoteser og actor-spor; repoet er offentligt, og alt i publish-roden kan serveres af Netlify. | M/H | Beslut placering før commit 2: privat mappe uden for repo (vault/privat repo) eller repo-mappe, der er udelukket fra deploy og dokumenteret offentlig. Pseudonym-actor-regel håndhæves af validator. | Alexander |

## Kontroller før nogen produktionsskrivning

1. Schemaer og semantisk validator er grønne på positive og negative fixtures.
2. Dry-run er read-only, deterministisk og viser præcis target, førværdi, efterværdi og sources.
3. Baseline er et frisk, komplet snapshot med hash; ingen blanding med REST.
4. En verificeret backup har `complete` manifest, hashes, row counts, migrationshead, policies og grants.
5. Human approver har godkendt samme operationshash, som apply vil bruge.
6. Apply kan udføres atomisk med preconditions og fuld abort; ingen DELETE i v1.
7. Read-back passer til plan, `npm run verify` er grøn, og revisionen refererer backup og outputhash.
8. Anon-negative write-tests og Supabase Security Advisor er grønne efter enhver DDL/policy/grant-ændring.

## Resterende usikkerheder og manuel afklaring

- Der er endnu ingen besluttet lagringsplacering eller retention for private inbox/revisionsfiler. De bør ikke automatisk ligge i det offentlige site-repo.
- Det er ikke besluttet, om et flerbrugerbehov nogensinde kræver databasebaseret inbox/audit. Indtil da er schemaændringen undgåelig.
- Der er ingen gennemført restore rehearsal af den nuværende 2026-07-15-eksport.
- Live migrationshistorik er afstemt, men fuld migrations-SQL er ikke versionsstyret i repoet.
- iCloud-kopiens retention, kryptering og uafhængighed er ikke verificeret.
- Service-role-håndtering, approver-identitet og eventuel signing er ikke designet; derfor må et automatisk apply-trin ikke bygges først.
- Officiel CVR/Virk-adgang, Netlify build hook og et isoleret restoremiljø kræver Alexanders credentials eller manuelle handling.

## Anbefalet første risikoreduktion efter reset

Implementér kun schemafiler, fixtures, ren filvalidering og snapshot-dry-run. Det reducerer R1–R10, R23–R25 og R27 uden credentials eller produktionsskrivning. Næste selvstændige leverance bør være backupmanifest+verifikation, fordi en troværdig rollback-forudsætning skal eksistere før et apply-værktøj overhovedet overvejes.
