# Databasebaseline — schema-only dump og katalogdiff

> Dateret 2026-07-22. Branch-base:
> `bfd621886dd78cf7744d2e3c9db27843b693f14f`. Dette er en read-only gate:
> ingen baseline-SQL, replay, migration, deploy eller ændring af Supabase-state er
> udført.

## Resultat

**Dokumenteret fakta:** Ét schema-only dump af production blev gennemført med
PostgreSQL `pg_dump 17.10` mod PostgreSQL 17.6. Dumpet har ingen tabeldata,
custom-role-DDL, executable owners/grants, credentials, e-mailadresser eller
CPR-kandidater efter den automatiske scan. Alle projektobjekter matcher den
eksisterende private katalogcapture på objektidentitet og antal.

Rå dump og log ligger ejerbeskyttet uden for repository'et. Kun sanitiseret
inventory, diff, provenance og checks er committet. Dumpet er ikke replayet og
er ikke i sig selv en godkendt baseline.

**Anbefalet næste skridt:** Projektet er modent til at *udarbejde* en
projekt-afgrænset, squashed baseline i en ny fase. Baseline må først committes,
når den er manuelt saniteret og replayet i en unlinked, isoleret PostgreSQL
17/Supabase-stack. Remote migrationshistorik må fortsat ikke afstemmes.

## Foranalyse: databasepassword og deploy

Repositoryet, GitHub Actions og `netlify.toml` bruger ikke databasepasswordet.
Trykpressen læser public Supabase REST med anon-nøglen, og normal produktion
serverer det statiske snapshot fra CDN. En ændring af postgres-passwordet
påvirker derfor ikke den versionsstyrede build-/deploykonfiguration.

Det kan ikke bevises fra repository'et, om eksterne manuelle scripts eller andre
ikke-versionerede klienter bruger samme password. De skal roteres/opdateres
separat. Passwordet blev ikke ændret, vist, kopieret til URL, shellargument,
log eller repository i denne gate.

## Metode og provenance

Supabase CLI var ikke installeret. Det foretrukne `supabase db dump --db-url`
blev derfor ikke improviseret via en credential-bearing URL eller en ny linked
CLI-state. I stedet blev den allerede verificerede PostgreSQL 17.10-klient brugt
direkte, fordi libpq kan læse passwordet fra en privat `PGPASSFILE` uden at lægge
det i procesargumenter.

De ikke-hemmelige forbindelsesfelter blev verificeret før dumpet:

- host: `aws-0-eu-west-1.pooler.supabase.com`;
- port: `5432`;
- database: `postgres`;
- bruger: `postgres.upaxzfytumsijnbhjihd`;
- TLS: `sslmode=verify-full` med den verificerede production-CA;
- sessionværn: `default_transaction_read_only=on`;
- `.pgpass`: mode `600`, placeret uden for repository'et.

Den eneste databaseoperation var:

```text
pg_dump --schema-only --no-owner --no-privileges --lock-wait-timeout=5s
```

`--no-owner` og `--no-privileges` fjerner executable owner-, GRANT- og
REVOKE-statements. `pg_dump` kørte med én forbindelse og skrev dump/log til det
private område. Der blev ikke kørt `db pull`, `db push`, `migration repair`,
`db reset`, `apply migration`, SQL-ændringer eller replay.

Private artefakter:

| Fil | Bytes | Linjer | SHA-256 | Mode |
|---|---:|---:|---|---|
| `production-schema-only.raw.sql` | 183.514 | 5.806 | `b2b592e5e512878bd6c7f2e0dee5fa9b0b861c3d5749dcee8a4600c8e2bd059e` | 600 |
| `production-schema-only.pg_dump.log` | 25.901 | 436 | `d9ac41e5025e003b97c7dc8d1a1809a8e8a8120699ab3d6c0e68f982cfec1eef` | 600 |

Loggen har 0 warnings og 0 failures. Private stier er ikke committet.

## Objektinventar

Dumpet indeholder 386 `pg_dump`-objektheadere. De fordeler sig på:

| Schema/scope | Objektheadere | Klassifikation |
|---|---:|---|
| `public` | 61 | Projektets schema |
| `auth` | 188 | Supabase-platform |
| `storage` | 62 | Supabase-platform |
| `realtime` | 33 | Supabase-platform |
| `extensions` | 10 | Platform/miljø |
| `supabase_migrations` | 3 | Supabase-platform |
| `graphql_public` | 1 | Supabase-platform |
| `pgbouncer` | 1 | Supabase-platform |
| Database-wide (`-`) | 27 | Extensions, event triggers, publication m.m. |

Projektets `public`-flade er:

| Objekttype | Dump | Katalogcapture | Resultat |
|---|---:|---:|---|
| Tabeller | 8 | 8 | Match |
| Tabelkolonner | 59 | 59 | Match |
| Sequences | 5 | 5 | Match |
| Views | 1 | 1 | Match |
| Funktioner | 1 | 1 | Match |
| Triggers | 3 | 3 | Match |
| Selvstændige indeks | 7 | 7 | Match |
| Constraints | 26 | 26 | Match |
| RLS-policies | 8 | 8 | Match |
| RLS-aktiverede tabeller | 8 | 8 | Match |

Katalogcapturens tidligere kolonneantal på 67 inkluderer 8 viewkolonner.
Dumpdiffen sammenligner de 59 fysiske tabelkolonner og selve viewobjektet; den
fremstiller ikke viewkolonner som tabelkolonner. Constraint-backed PK/UNIQUE-
indeks sammenlignes som constraints, mens de 7 selvstændige indeks sammenlignes
som indeks.

Database-wide objekter:

- dumpede extensions: `moddatetime`, `pg_stat_statements`, `pgcrypto`,
  `supabase_vault`, `uuid-ossp`;
- publication: `supabase_realtime`;
- event triggers: `ensure_rls`, `issue_graphql_placeholder`,
  `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`,
  `pgrst_ddl_watch`, `pgrst_drop_watch`.

Katalogcapturen har desuden `plpgsql`. Det er en dokumenteret, forventet
forskel: den installerede indbyggede extension er synlig i kataloget, men bliver
ikke emitteret som et `CREATE EXTENSION`-objekt i dette dump. `public` er
tilsvarende et initialt schema og emitteres ikke som `CREATE SCHEMA`; alle dets
objekter er stadig til stede og afstemt.

## Owners, grants og ACL

Dumpet har 0 executable OWNER-, GRANT- og REVOKE-statements, som krævet.
Owners/ACL blev derfor inventariseret fra katalogcapturen i stedet for at blive
gjort replaybare ved et uheld:

- owners: 14 public-relationer, public-funktionen og publicationen ejes af
  `postgres`; extensions er delt 3/3 mellem `postgres` og `supabase_admin`;
  6 af 7 event triggers ejes af `supabase_admin`, mens `ensure_rls` ejes af
  `postgres`; `public` bruger `pg_database_owner`;
- 5 database-ACL-poster;
- 348 relationsprivilegier;
- 300 default-ACL-poster;
- 6 schema-ACL-poster;
- 2 funktions-ACL-poster.

Dette er inventory, ikke et forslag om at kopiere platformowners/default ACL
ind i baseline. En senere baseline skal skrive projektets tilsigtede grants
eksplicit og teste negative anon/auth-writes.

## Sikkerhedsscan

Automatiske fund i rå dump:

- data-sektioner, `COPY FROM stdin`, top-level INSERT/UPDATE/DELETE/TRUNCATE,
  sequence-values og large-object-data: **0**;
- `CREATE ROLE`, `ALTER ROLE`, OWNER, GRANT og REVOKE: **0**;
- private keys, Supabase secret keys, JWT'er, credential-URI'er og password-
  literals: **0**;
- e-mailadresser og CPR-kandidater: **0**;
- project ref, Supabase-hosts og database-settings indlejret i SQL: **0**.

Scanneren fjerner funktionskroppe ved rækkedatascannet, så legitim DML inde i en
funktionsdefinition ikke fejlklassificeres som dumpede tabelrækker. Credential-
og persondatascannet kører derimod på hele råteksten. Scanningen er et værn, ikke
en erstatning for manuelt review; råfilen forbliver privat.

## Miljøspecifikke og ikke-portable dele

Følgende må ikke kopieres ukritisk til en squashed projektbaseline:

- schemas og objekter under `auth`, `storage`, `realtime`, `extensions`,
  `graphql_public`, `pgbouncer` og `supabase_migrations`;
- Supabase-platformens seks event triggers og `supabase_realtime`-publication;
- platformowners og default ACL;
- extensions, der ikke har en bevist projektafængighed;
- `public.rls_auto_enable()` og `ensure_rls`, fordi kombinationen er
  `SECURITY DEFINER`/event-trigger og kræver særskilt sikkerheds- og
  portability-review.

`moddatetime` er en konkret baselinekandidat, fordi tre projekttriggers afhænger
af den. De øvrige extensions skal kun medtages, hvis en faktisk public-definition
kræver dem.

## Præcis afgrænsning af senere squashed baseline

**Anbefalet — ikke udført i denne branch:**

1. Medtag kun de 8 public-tabeller, 59 tabelkolonner, 5 sequences/defaults,
   26 constraints, 7 selvstændige indeks, `investor_status`-viewet, de 3
   `moddatetime`-triggers, RLS på 8 tabeller og 8 SELECT-policies.
2. Etabler kun dokumenterede project-extension-dependencies; start med
   `moddatetime`. Forudsæt `plpgsql` som platform/runtime, ikke som custom role-
   eller platformdump.
3. Review `rls_auto_enable()`/`ensure_rls` separat. Baseline skal være sikker,
   selv hvis event-trigger-automatikken udelades, ved at aktivere RLS eksplicit.
4. Skriv owners/grants som en lille, tilsigtet, portabel kontrakt. Kopiér ikke
   Supabase-platformens owners/default ACL mekanisk.
5. Udelad al historisk DML, tabeldata, platformschemas, publication, platform-
   event-triggers og migrationshistorik.
6. Replay først på tom, unlinked PostgreSQL 17/Supabase med syntetiske fixtures;
   bevis normaliseret schema-paritet, constraints, view/funktion/triggers,
   policies/grants og negative writes.
7. Stop igen før `migration repair`, `db push` eller anden remote
   historikafstemning. Det er en særskilt production-write-gate.

## Filbaserede checks og mutationstests

Følgende kræver hverken private captures, credentials eller databaseadgang:

```bash
npm run check:schema-dump-review
npm run test:schema-dump-review
```

Checket blokerer rå dump/log/`.pgpass` i Git, falske read-only-/replayclaims,
forkerte flags/versioner, data-/credentialfund, objektdrift og private paths.
Mutationstesten dækker dumpede rækker, top-level INSERT, DML i funktionskrop,
custom roles, GRANT/REVOKE, credentialmønstre, persondata, miljøreference og
manglende/ekstra objekter. Begge checks er en del af `npm run verify`.

## Stopgrænse

Ingen baseline-SQL er oprettet eller committet. Ingen rå dump, log, `.pgpass`,
password eller privat sti ligger i Git. Ingen replay, deploy, PR, merge eller
Supabase-write er udført.
