# Database-migrationer og recovery-fundament

> Dateret 2026-07-22. Scope: read-only kortlægning og filbaserede værn. Ingen
> live Supabase-ændring, credentials, deploy eller baseline-registrering er udført.

## Læsevejledning

- **Dokumenteret fakta** er observeret i repository'et, den kanoniske vault,
  Supabases read-only katalog/API eller den officielle Supabase-dokumentation.
- **Anbefalet næste skridt** er et forslag og er ikke udført eller godkendt som
  produktionsændring.

## Dokumenteret fakta — nuværende tilstand

Katalogaflæsningen 2026-07-22 viser PostgreSQL 17.6 i projekt
`upaxzfytumsijnbhjihd`. `public` har otte tabeller, fem sequences og viewet
`investor_status`. Alle otte tabeller har RLS aktiveret; viewet har
`security_invoker=true`. Security Advisor gav 0 lints. Performance Advisor gav
to informationsfund om aktuelt ubrugte FK-indeks; det er ikke i sig selv bevis
for, at de bør droppes.

Installerede ikke-platformsspecifikke udvidelser, som det aktuelle public-schema
direkte afhænger af, omfatter `moddatetime` (tre `updated_at`-triggers). Projektet
har desuden Supabase-platformudvidelser; en baseline må skelne mellem
projekt-ejet DDL og platform-ejet schema.

### Public-objekter og væsentlige regler

| Objekt | Dokumenteret schema-/SQL-funktion |
|---|---|
| `companies` | PK, identity, UNIQUE navn/slug, kategori- og status-CHECK, `updated_at`-trigger |
| `deals` | PK/sequence, generated `aftale`, FK til company, sæson/aftale/company-indeks |
| `deal_investors` | Sammensat PK, FK til deal/investor, investorindeks |
| `investors` | PK/identity, UNIQUE navn/slug, `updated_at`-trigger |
| `seasons` | PK |
| `panel_memberships` | Sammensat PK, to FK'er, rolle-CHECK, investorindeks |
| `company_events` | PK/identity, FK `ON DELETE CASCADE`, event-/præcisions-CHECK, trigger og indeks |
| `sources` | PK/identity, entity-/confidence-/URL-CHECK og entityindeks; polymorf `entity_id` uden FK |
| `investor_status` | View med invoker-rettigheder |
| `rls_auto_enable()` / `ensure_rls` | SECURITY DEFINER med `search_path=pg_catalog`; anon/authenticated har ikke EXECUTE |

Alle otte tabeller har en permissiv SELECT-policy. `deals`-policyen er målrettet
`anon`; de øvrige syv bruger rollen `public`. Kataloget viser samtidig alle
tabelprivilegier til både `anon` og `authenticated`, inklusive write-privilegier.
RLS-policyerne blokerer de aktuelle offentlige writes, men RLS og grants er to
uafhængige lag. Dette er en defense-in-depth-risiko, ikke en konstateret aktuel
write-adgang.

### Inventar over eksisterende migrationer

Den eksterne historik rummer 16 migrationer. Samme maskinlæsbare liste ligger i
`supabase/migration-inventory.json`.

| Version | Navn | Dokumenteret formål fra navn/vault | SQL i repo? |
|---|---|---|---|
| 20260710002859 | `drop_legacy_companies_cvr_skeleton` | Fjern tidligere company/CVR-skelet | Nej |
| 20260710002924 | `create_seasons_and_investors` | Opret sæsoner og investorer | Nej |
| 20260710002949 | `create_panel_memberships` | Opret sæsonbaserede panelroller | Nej |
| 20260710003009 | `create_companies_from_deals` | Normalisér companies fra deals | Nej |
| 20260710003022 | `add_deals_company_fk` | Knyt deals til companies | Nej |
| 20260710003040 | `create_deal_investors` | Normalisér deal-investor-relationen | Nej |
| 20260710003102 | `create_investor_status_view_and_policies` | View og adgangspolitikker | Nej |
| 20260710003313 | `fix_view_invoker_and_function_grants` | Invoker-view og funktionsrettigheder | Nej |
| 20260710182227 | `soak_cleanup_drop_investor_text_and_backups` | Fjern legacytekst og soak-backuptabeller | Nej |
| 20260711161231 | `create_company_events` | Efterlivshændelser | Nej |
| 20260711161251 | `create_sources` | Polymorfe kilder/confidence | Nej |
| 20260712034247 | `updated_at_triggers_and_source_url_check` | Triggers og URL-CHECK | Nej |
| 20260712035152 | `fk_indexes_and_index_cleanup` | FK-indeks og indeksoprydning | Nej |
| 20260712035501 | `drop_redundant_deals_columns` | Fjern duplikerede domænefelter | Nej |
| 20260714210037 | `apply_category_taxonomy` | Lås kategorivokabular | Nej |
| 20260714212928 | `allow_unknown_episode` | Tillad legitimt NULL-afsnit | Nej |

Read-only katalogkontrol viser desuden, at `supabase_migrations.schema_migrations`
har en `statements`-kolonne, og at hver af de 16 poster har ét opbevaret statement.
Inventaret gemmer statement-antal og MD5-fingeraftryk, men ikke SQL-indhold.
Det gør exact-history-sporet sandsynligt uden at gøre denne branch til en rå
SQL-eksport.

Historisk DDL findes delvist i vaultens `database.md` og
`noter/2026-07-09_migrering-trin1-6.md`. Det er værdifuld evidens, men ikke et
reviewet, komplet og replay-testet migrationssæt. Repository'et havde før denne
branch ingen `supabase/`-mappe eller migrationsfiler.

## Dokumenteret fakta — backup- og recoverygrænser

Vaultens `tools/backup.sh` eksporterer public-data som JSON til en privat
iCloud-mappe. Den senest dokumenterede bevaringseksport har data og en navneliste
over migrationer, men ikke et komplet, versionsstyret schema med funktioner,
triggers, policies, grants, sequences og platformgrænser. En JSON-eksport er
derfor ikke alene et bevist database-restore.

Supabases officielle dokumentation fastslår desuden:

- migrationer ligger normalt som `supabase/migrations/<timestamp>_<name>.sql`;
- `supabase db pull` på et eksisterende projekt opretter en baseline **og
  registrerer den i den eksterne migrationshistorik**;
- `migration repair` ændrer den eksterne migrationshistorik;
- databasebackups omfatter ikke Storage-objekter, og custom role passwords
  gendannes ikke;
- fysisk/PITR-backup kan begrænse direkte download, så en separat logisk eksport
  stadig er nødvendig for portabel recovery.

Kilder: [lokal udvikling](https://supabase.com/docs/guides/local-development/overview),
[CLI-workflows](https://supabase.com/docs/guides/local-development/cli-workflows),
[database-migrationer](https://supabase.com/docs/guides/deployment/database-migrations),
[migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair),
[backups](https://supabase.com/docs/guides/platform/backups) og
[backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Anbefalet næste skridt — baseline-strategi

Baseline etableres i gates. Ingen gate må springes over.

### Gate 0 — inventar (opfyldt af denne branch)

Bevar de 16 eksterne versionsnumre/navne og det observerede schema som evidens.
Markér historikken `inventory_only_not_replayable`. Opret ingen tomme SQL-filer.

### Gate 1 — privat, read-only schemafangst (opfyldt 2026-07-22)

Med særskilt godkendte, kortlivede read-credentials tages en schema-only eksport
til et privat tempområde. Eksporten skal omfatte projekt-ejede extensions,
sequences/identity, tabeller, defaults/generated columns, constraints, indeks,
funktioner, triggers, viewdefinitioner, RLS, policies, grants, default privileges,
comments og migrationstabellen. Ownership, platform-ejede schemas, passwords og
følsomme settings skal bortfiltreres og reviewes før noget kan committes.

Read-only MCP-capture har hentet alle 16 statements og et high-fidelity
katalogsnapshot privat; sanitiseret resultat og provenance står i
[`database-baseline-readonly-capture.md`](database-baseline-readonly-capture.md).
Et efterfølgende PostgreSQL 17.10 `pg_dump --schema-only --no-owner
--no-privileges` er nu gennemført én gang read-only og afstemt objekt-for-objekt
mod katalogcapturen. Resultat, sikkerhedsscan og den præcise projekt/platform-
afgrænsning står i
[`database-schema-dump-readonly-review.md`](database-schema-dump-readonly-review.md).
Rå dump/log er fortsat private. Brug ikke `db pull`, `migration repair` eller
andre remote-state-kommandoer i denne gate.

### Gate 2 — vælg én ærlig baselineform (draft udarbejdet 2026-07-23)

1. **Anbefalet efter capture-review:** opret én reviewet, squashed current-state
   schema-baseline fra et officielt, saniteret schema-only dump. Capturen beviser,
   at de 16 historiske statements refererer til en præeksisterende `deals`-tabel,
   som de ikke selv opretter; exact-history-kæden er derfor ikke tom-database-
   replaybar.
2. Bevar de 16 versionsnumre, hashes, klassifikationer og private statements som
   auditspor. Flyt ikke historisk DML eller produktionsdata ukritisk ind i
   schema-baselinen.

Der må ikke både vedligeholdes en deklarativ schemafil og ordnede SQL-migrationer
som to parallelle sandheder. Supabases declarative schema/`pg-delta` er fortsat
alpha pr. 2026-07-22; hulensdata bør bruge ordnede SQL-migrationer.

En deterministisk, project-only SQL-draft og dens maskinelle inventory er nu
udledt lokalt af det verificerede private dump. Den matcher den sanitiserede
capture, men er hverken replayet, promoveret til migration eller afstemt med
remote historik. Metode, eksklusioner og stopgrænse står i
[`database-project-baseline-draft.md`](database-project-baseline-draft.md).

### Gate 3 — isoleret replay og schema-paritet

Kør migrationerne på en tom lokal Postgres/Supabase-stack. Sammenlign et
normaliseret schema-dump med den saniterede produktionsfangst. Diffen skal være
tom eller have en reviewet allowlist for platform-ejede forskelle. Kør derefter
RLS/grant-tests, integritetsqueries, advisors/lint og Trykpressen mod syntetiske
eller saniterede fixtures.

### Gate 4 — autoriseret historikafstemning

Først efter godkendt replay og recovery drill må en senere branch afstemme den
eksterne migrationshistorik. Det er en production-write, selv hvis kun
`supabase_migrations` ændres, og kræver før-backup, review, eksplicit autorisation
og efterkontrol. Før Gate 4 må `db push` ikke bruges mod projektet.

## Anbefalet næste skridt — fremtidig migrationsdisciplin

- Opret migrationer med `supabase migration new <lille_snake_case_navn>`.
- Én logisk ændring pr. fil; bevar fremadrettet append-only historik.
- Dokumentér preconditions, påvirkede objekter, lock-/datatabrisiko, efterkontrol
  og recovery i filens kommentar og reviewbeskrivelse.
- Test på tom lokal database og på en repræsentativ restore-fixture.
- Behandl schema, RLS, policies, grants og default privileges eksplicit.
- DML-backfills skal være idempotente eller have entydige preconditions; NULL må
  ikke coerce's til tom streng, nul eller `false`.
- Destruktive ændringer bruger expand/contract, bevarer en recovery-vej og kræver
  en frisk, verificeret backup.
- Kør Security/Performance Advisor efter senere DDL. Drop ikke de to “unused”
  indeks uden repræsentativ queryevidens og kendt statistik-reset.

## Filbaserede checks uden production-writes

Denne branch tilføjer:

```bash
npm run check:database-foundation
npm run test:database-foundation
npm run check:schema-dump-review
npm run test:schema-dump-review
npm run check:project-baseline-draft
npm run test:project-baseline-draft
```

De validerer inventarformat, streng versionsorden, remote head, eksplicit
ikke-replaybar status, filnavne, placeholder-SQL, lokal Supabase-state, symlinks,
typiske credentialmønstre samt draftens objektparitet, dependencyorden og
eksklusioner. Mutationstestene beviser non-zero exit ved blandt andet dublet,
forkert head, falsk replayability, placeholder-SQL, credential, indlejret DML,
platform-DDL og objektdrift.

Senere, når en lokal baseline findes, bør CI desuden kunne køre helt lokalt:

- start/reset af en **ulinked lokal** Supabase-stack;
- replay fra tom database;
- normaliseret schema-diff og schemahash;
- SQL-tests af constraints, FK'er, generated columns, RLS, grants og anon-write;
- restore af syntetisk fixture i FK-rækkefølge og sekvens-/identitykontrol;
- orphan-check for `sources` og eksisterende `npm run verify` fra fixture-snapshot;
- backupmanifest-, checksum-, afkortnings- og corruption-mutationer.

Forbudt i disse checks: produktionscredentials, `--linked` reset, `db push`,
`migration repair`, live writes og afhængighed af private editorial-filer.

## Risici og åbne beslutninger

| Risiko | Konsekvens | Næste beslutning |
|---|---|---|
| Historisk SQL er privat fanget, men kæden mangler det oprindelige `deals`-schema | Repo kan ikke genskabe schemaet fra de 16 statements | Byg squashed current-state baseline efter officielt schema-only dump |
| Schema-dump er fanget, men endnu ikke replayet | Capture-paritet beviser ikke restore eller portabel DDL | Udled en project-only baseline og bevis replay isoleret |
| Brede anon/auth grants | Større blast radius ved fremtidig policy/RLS-fejl | Separat privilege-hardening-migration efter baseline |
| Polymorf `sources.entity_id` | Orphans kan omgå database-FK | Bevar build-check og tilføj restore-integritetsquery |
| `ON DELETE CASCADE` for events | Company-delete kan fjerne historik | Ingen delete uden dependency-preview og recovery-gate |
| Ét produktionsmiljø | Restore-test kan ramme live ved operatørfejl | Kræv unlinked lokal/throwaway target og target-ID-check |
| Platform-/project-DDL blandes | Baseline kan blive støjende eller skrøbelig | Reviewet allowlist og normaliseret schema-diff |
| Credentials i dump/log | Hemmeligheder kan havne i git/CI | Privat temp, secret scan, sanitering og manuel review |

Den første anbefalede efterfølgende branch er nu en isoleret, lokal replay-gate
for project-only draften. Den må ikke forbinde til produktion eller markere
remote historik som afstemt. Baseline-SQL må først blive migrationskandidat efter
normaliseret diff og særskilt review af `SECURITY DEFINER`, event trigger,
`moddatetime` og ACL.
