# Databasebaseline — privat read-only capture

> Dateret 2026-07-22. Branch-base:
> `a576c70e0c9426fecf61237849602a5d939a396b`. Capturen har ikke skrevet til
> Supabase, ændret migrationshistorik, dannet baseline-SQL eller kørt replay.

## Resultat

**Dokumenteret fakta:** Alle 16 registrerede migrations-statements er hentet
read-only og gemt privat uden for repository'et. MD5 er beregnet over samme
kontrakt som inventaret — `statements.join('\n')` — og **16 af 16** matcher det
registrerede fingeraftryk.

Der er samtidig taget et high-fidelity katalogsnapshot af projektets aktuelle
schemaflade: 14 public-relationer (8 tabeller, 5 sequences og 1 view), 67
kolonner, 26 constraints, 19 indeks, 1 funktion, 3 triggers, 8 RLS-policies,
348 effektive relationsprivilegier, 300 default-ACL-poster, 6 installerede
extensions, 7 event triggers og 1 publication.

**Vigtig afgrænsning:** Katalogsnapshottet dækker projektets `public`-schema og
relevante database-wide metadata med definitioner, ACL og egenskaber. Det
indeholder ingen tabelrækker. Det er ikke et officielt `pg_dump`-arkiv og må ikke
beskrives som et bevist, direkte replay-input. Supabase CLI/`pg_dump` var ikke
installeret, og der blev ikke introduceret databasepassword eller connection
string for at omgå denne grænse.

## Capture-metode og provenance

1. Branchen blev oprettet præcist fra den angivne base.
2. Supabases aktuelle changelog og officielle CLI-/dumpdokumentation blev
   kontrolleret. `db pull` blev fravalgt, fordi den registrerer en ekstern
   migration; `db dump` kræver en linked CLI/databaseforbindelse.
3. To committede, statisk kontrollerede SELECT-queries blev kørt gennem den
   autentificerede Supabase MCP-connector:
   - `tools/sql/capture-migrations-readonly.sql`
   - `tools/sql/capture-project-schema-readonly.sql`
4. Connectoren udførte én `SELECT` pr. capture. Der blev ikke kaldt
   `apply_migration`, `migration repair`, `db push`, databasefunktioner med
   sideeffekter eller nogen DDL/DML-kommando.
5. Rå JSON blev skrevet direkte til en ejerbeskyttet mappe uden for repoet.
6. `tools/analyze-baseline-capture.mjs` læste de private filer lokalt,
   verificerede fingerprints, klassificerede statements og skrev kun
   sanitiseret metadata til `supabase/baseline-capture-review.json`.
7. En afsluttende read-only `list_migrations` viste fortsat 16 poster og samme
   remote head `20260714212928`; capturen ændrede ikke migrationshistorikken.

Capture-tider i UTC:

- migrations: `2026-07-22T00:35:26.467103+00:00`;
- schema: `2026-07-22T00:39:52.864772+00:00`;
- PostgreSQL: 17.6;
- project ref: `upaxzfytumsijnbhjihd`.

Queryernes SHA-256 og alle statementfingeraftryk ligger i den sanitiserede
metadata. Rå filstørrelser og SHA-256 ligger kun i det private capturemanifest.

Supabasekilder:
[CLI-workflow](https://supabase.com/docs/guides/local-development/cli-workflows),
[database-migrationer](https://supabase.com/docs/guides/deployment/database-migrations)
og [manuel dump/restore](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres).

## Klassifikation og sikkerhedsflag

Klassifikationerne er multi-label. “Mulig offentlig persondata” er et
konservativt flag for DML, der berører investornavne/relationer; det er ikke et
fund af private kontaktoplysninger. “Miljøreference” dækker Supabase-roller,
URLs eller extensions, som skal vurderes ved portabel replay.

| Version | Migration | Klassifikation | Automatiske flag | Replaystatus |
|---|---|---|---|---|
| 20260710002859 | `drop_legacy_companies_cvr_skeleton` | DDL | Destruktiv | Usikker uændret |
| 20260710002924 | `create_seasons_and_investors` | DDL, DML | DML, mulig offentlig persondata, miljøreference | Usikker uændret |
| 20260710002949 | `create_panel_memberships` | DDL, DML | DML, mulig offentlig persondata | Usikker uændret |
| 20260710003009 | `create_companies_from_deals` | DDL, DML | DML | Usikker uændret |
| 20260710003022 | `add_deals_company_fk` | DDL, DML | DML | Usikker uændret |
| 20260710003040 | `create_deal_investors` | DDL, DML | DML, mulig offentlig persondata | Usikker uændret |
| 20260710003102 | `create_investor_status_view_and_policies` | DDL, permissions, policy, function/view | Miljøreference | Blokeret til dependency-review |
| 20260710003313 | `fix_view_invoker_and_function_grants` | Permissions, function/view | Miljøreference | Blokeret til dependency-review |
| 20260710182227 | `soak_cleanup_drop_investor_text_and_backups` | DDL | Destruktiv | Usikker uændret |
| 20260711161231 | `create_company_events` | DDL, policy | Ingen automatisk | Blokeret til dependency-review |
| 20260711161251 | `create_sources` | DDL, policy | Ingen automatisk | Blokeret til dependency-review |
| 20260712034247 | `updated_at_triggers_and_source_url_check` | DDL, DML | DML, mulig offentlig persondata, miljøreference | Usikker uændret |
| 20260712035152 | `fk_indexes_and_index_cleanup` | DDL | Destruktiv | Usikker uændret |
| 20260712035501 | `drop_redundant_deals_columns` | DDL | Destruktiv | Usikker uændret |
| 20260714210037 | `apply_category_taxonomy` | DDL, DML | DML | Usikker uændret |
| 20260714212928 | `allow_unknown_episode` | DDL | Ingen automatisk | Blokeret til dependency-review |

Samlet:

- DDL: 15 statements;
- DML: 7;
- permissions: 2;
- policy: 3;
- function/view: 2;
- andet: 0;
- destruktiv SQL: 4;
- mulige credential-/secretfund: 0;
- mulige offentlige persondatareferencer: 4;
- miljøreferencer: 4;
- rollback-arrays med indhold: 0;
- idempotency keys: 0.

Alle 16 har `commit_status=hold_raw_private`. 11 er markeret
`unsafe_unmodified`; de resterende 5 er blokeret, indtil dependencies og
isoleret replay er gennemgået. Ingen er replay-godkendt.

## Secret-, credential- og persondatascan

Scanningen kontrollerer mindst JWT-format, Supabase secret keys, private-key-
headers, credential-bearing Postgres-URI'er, password literals, e-mail,
CPR-lignende værdier, offentlige personnavne i investor-DML, projektrefs, URLs,
extensions og Supabase-roller.

**Dokumenteret resultat:** Der blev ikke fundet secrets, credentials,
e-mailadresser eller CPR-kandidater i statements. Fire statements blev
konservativt flaget for offentlig persondata. Schema-capturen indeholder ingen
tabelrækker og gav ingen secret-, credential- eller persondatafund. Den indeholder
miljøspecifikke ejere, roller, ACL, extensions/versioner, locale og publication;
derfor forbliver rå schemafil privat.

Den automatiske scan er et værn, ikke en garanti. Et senere SQL-commit kræver
fortsat manuel linje-for-linje-review.

## Kritisk replayfund

**Dokumenteret fakta:** De 16 statements refererer til den præeksisterende
`deals`-tabel, men ingen af dem opretter dens basisschema. Migrationskæden starter
altså efter en ældre, uversioneret databasefase. Den kan ikke alene genskabe
databasen fra tom Postgres, selv om alle fingerprints er korrekte.

Derudover indeholder historikken syv DML-statements, fire destruktive statements,
ingen rollback-arrays og ingen idempotency keys. Et uændret replay kan både fejle
på manglende legacy-state og ændre/slette data i en forkert targettilstand.

## Anbefaling til replayfasen

**Anbefalet næste skridt — ikke udført:**

1. Tag et officielt schema-only `pg_dump`/`supabase db dump` read-only til samme
   private område med kortlivede credentials og matchende PostgreSQL 17-klient.
2. Sammenlign dumpet objekt-for-objekt med katalogcapturen; forklar alle
   forskelle i owners, platformextensions, grants, event triggers og publication.
3. Byg én squashed, current-state schema-baseline fra det saniterede dump — ikke
   de 16 historiske statements som tom-database-kæde.
4. Hold historikmetadata og fingerprints som auditspor. Flyt historisk DML til
   syntetiske seed-/restore-fixtures eller eksplicitte, reviewede backfills; kopiér
   ikke produktionsrækker ind i schema-baselinen.
5. Replay kun i en unlinked lokal Supabase/Postgres 17-stack. Bevis schemahash,
   constraints, view/funktion/triggers, RLS, policies, grants/default ACL og
   negative anon/auth-write-tests.
6. Stop igen før nogen remote historikafstemning. En senere markering af baseline
   som applied er en særskilt production-write med egen godkendelse.

## Stopgrænse

Denne branch leverer capture og reviewforberedelse. Den committer ingen rå SQL,
ingen `pg_dump`, ingen credentials og ingen baseline-migration. Den kører heller
ikke replay, deploy, `db pull`, `migration repair` eller `db push`.
