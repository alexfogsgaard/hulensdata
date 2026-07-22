# Lokal replay-gate for project-only databasebaseline

> Dateret 2026-07-23. Branch-base:
> `d6cfebae23b13022cd5c5cd5cf4671a845acb3f0`. Gaten er udelukkende
> lokal. Ingen productionforbindelse, credentials, Supabase-remote-write,
> `db pull`, `db push`, `migration repair`, replay mod remote eller ændring af
> migrationshistorik er udført.

## Resultat

**Dokumenteret fakta:** Den uændrede project-only baseline-draft blev replayet
succesfuldt i to uafhængige, tomme PostgreSQL 17-clusters. Begge sluttilstande
har samme normaliserede schemahash:

```text
0ecb797214887990a380322bbb60100290ca436c81327e404265313cc81ec7a2
```

Alle forventede project-objekter matcher `schema-dump-review.json`; ingen
uventede project-objekter eller tabeldata blev fundet. RLS er aktiv på alle otte
tabeller, alle 18 positive SELECT-statements kunne udføres, og 48 af 48
INSERT/UPDATE/DELETE-probes for `anon` og `authenticated` blev afvist.

Replayet gav samtidig to reviewfund, som blokerer direkte promotion:

1. `public.rls_auto_enable()` får PostgreSQLs default `PUBLIC EXECUTE`, så
   `anon` og `authenticated` har EXECUTE efter baseline-only replay. Det lokale
   ACL-udkast fjerner rettigheden, men draften er ikke sikker som selvstændig
   adgangskontrakt.
2. `deals`-policyen gælder kun `anon`; `authenticated` kan udføre SELECT, men ser
   ingen rows. De øvrige syv tabelpolicies gælder `public`.

**Anbefaling:** Fjern `rls_auto_enable()` før baselinepromotion, medmindre et
separat krav til event-trigger-automatik godkendes. Normalisér derefter den
tilsigtede policyrolle for `deals`, færdiggør ACL-kontrakten og gentag replay.

## Toolchain og afgrænsning

Replayet blev kørt på macOS 26.5.1, Darwin 25.5.0, arm64 med én samlet
PostgreSQL 17.10-toolchain:

| Værktøj | Verificeret version |
|---|---|
| `postgres` | 17.10 |
| `psql` | 17.10 |
| `pg_dump` | 17.10 |
| `initdb` | 17.10 |
| `pg_ctl` | 17.10 |
| `moddatetime` | 1.0, installeret som officiel PostgreSQL contrib-extension |

Supabase CLI og Docker/container-runtime var ikke installeret. Gaten tester
derfor **Supabases database-lag**, ikke hele den lokale service-stack. De lokale
clusters bruger Supabase-kompatible `anon`- og `authenticated`-roller og den
samme `extensions.moddatetime()`-dependency, men Auth, REST/PostgREST, Storage,
Realtime og gateway er ikke startet eller testet. Det er en eksplicit
begrænsning, ikke et grønt resultat for disse services.

## Isolation

Replayrunneren håndhæver følgende:

- to separate `initdb`-clusters og ingen genbrug af databasefiler;
- `listen_addresses=''`, så PostgreSQL ikke lytter på TCP;
- forbindelse udelukkende gennem korte, midlertidige Unix-sockets;
- `--auth-host=reject`; lokal socket-auth bruges kun i den ejerejede tempcluster;
- eksplicit `--host`, `--port`, `--username` og `--dbname` til alle klientkald;
- fjernelse af `DATABASE_URL`, Supabase-token- og alle `PG*` connectionvariable
  fra child-processernes miljø;
- ingen `supabase/config.toml`, linked state, project ref eller credentials;
- cluster-/socketmapper slettes efter hvert run, også ved fejl.

Den sanitiserede resultatsfil dokumenterer `production_connections: 0`,
`remote_supabase_writes: false`, to oprettede og to destruerede clusters samt en
tom liste over forbudte kommandoer.

## Reproducerbar precondition

`tools/sql/local-baseline-preconditions.sql` opretter kun:

- `anon` og `authenticated` som `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`,
  `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, `NOBYPASSRLS`;
- schemaet `extensions` med lokal `postgres` som owner;
- `CREATE EXTENSION moddatetime WITH SCHEMA extensions`.

Før baseline kontrolleres, at target har nul public tabeller, views og sequences.
Preconditionen ligger separat fra baseline-SQL, og baselinehashen forblev:

```text
cd3e13b826e278ced948d96fb75157834647dabeedb5654b20956bdbe2076e57
```

## Replayflow

Hvert af de to runs udfører samme sekvens:

1. initialisér en helt ny PostgreSQL 17-cluster;
2. bevis socket-only isolation og nul public projektrelationer;
3. opret lokale roller og `moddatetime`-precondition;
4. replay den uændrede baseline-draft med `ON_ERROR_STOP`;
5. bevis nul rows i alle otte tabeller;
6. tag `pg_dump --schema-only --no-owner --no-privileges --schema=public`;
7. sammenlign objekt-for-objekt med `schema-dump-review.json`;
8. inventarisér owner, function ACL, RLS, policies og katalogvaliditet;
9. anvend ACL-kontraktudkastet **kun lokalt**;
10. indlæs en syntetisk fixture og kør SELECT-/write-/trigger-/viewtests;
11. tag nyt schema-only dump og bevis, at fixture/ACL ikke ændrede den
    privilege-frie schemaflade;
12. stop serveren og slet cluster/socket.

Rå logs og dumps er gemt i et privat captureområde uden for repository'et. Det
private manifest peger kun på de seneste to runs og har checksums; ingen privat
sti, rå dump, log eller databasefil ligger i Git.

## Normaliseret schema-diff

Objektresultatet mod det sanitiserede production-review er:

| Kategori | Forventet | Lokal | Mangler | Ekstra |
|---|---:|---:|---:|---:|
| Tabeller | 8 | 8 | 0 | 0 |
| Fysiske tabelkolonner | 59 | 59 | 0 | 0 |
| Sequences | 5 | 5 | 0 | 0 |
| Views | 1 | 1 | 0 | 0 |
| Funktioner | 1 | 1 | 0 | 0 |
| Triggers | 3 | 3 | 0 | 0 |
| Selvstændige indeks | 7 | 7 | 0 | 0 |
| Constraints | 26 | 26 | 0 | 0 |
| Policies | 8 | 8 | 0 | 0 |
| RLS-tabeller | 8 | 8 | 0 | 0 |

Den lokale `public`-schemaheader er den eneste allowlistede miljøforskel. Den er
en eksplicit target-precondition, ikke et ekstra project-objekt; production-
reviewets `--no-owner --no-privileges`-dump emitterede ikke samme header. Der er
ingen andre schemaforskelle.

Katalogkontrollen viser desuden 26/26 validerede constraints, 7/7 valid/ready
selvstændige indeks, 3/3 aktiverede brugertriggers og 8 policies. Schema-only-
scannet har nul `COPY`, INSERT, UPDATE, DELETE, TRUNCATE, `setval` og large-object-
datasignaler.

Den normaliserede hash beviser determinisme mellem de to lokale runs. Diffen mod
production er objektbaseret via den sanitiserede JSON; den påstår ikke en ny
byte-for-byte sammenligning med det private productiondump.

## SELECT, RLS og negative writes

ACL-udkastet blev anvendt efter baseline-diffen og kun i de lokale clusters.
En syntetisk fixture gav én række i hver tabel og verificerede generated
`deals.aftale`, `investor_status` samt alle tre `moddatetime`-triggers.

Baseline-only havde ingen table- eller sequence-grants til applikationsrollerne;
den havde derfor heller ikke positiv Data API-læseadgang uden en separat ACL.
Den eneste offentlige default var function EXECUTE-fundet. Efter det lokale
ACL-udkast havde begge roller SELECT på præcis de otte tabeller og viewet, ingen
write-/sequenceprivilegier og ingen EXECUTE på definerfunktionen.

| Test | Resultat |
|---|---:|
| RLS-aktiverede tabeller | 8/8 |
| Policies | 8/8 |
| SELECT-statements der kunne udføres | 18/18 |
| Relationer med synlig fixture for `anon` | 9/9 inkl. view |
| Relationer med synlig fixture for `authenticated` | 8/9 |
| INSERT/UPDATE/DELETE-probes | 48/48 afvist |
| Uventede table write-privilegier | 0 |
| Uventede sequence-privilegier | 0 |

`authenticated`-afvigelsen er præcis `deals`: SELECT-statementet lykkes, men RLS
returnerer nul rows, fordi den fangede policy bruger `TO anon`. Det er ikke en
replayfejl; det er en eksisterende policyasymmetri, der skal besluttes før
promotion.

Alle 15 lokale project owners — 8 tabeller, 5 sequences, view og funktion — er
`postgres`, som forventet for dette isolerede target. Det er ikke et forslag til
fremtidigt production-ownership.

## ACL-kontraktudkast

`supabase/baseline/project-schema-acl.contract.draft.sql` er testet lokalt, men
er ikke en migration og må ikke køres mod production. Det gør følgende:

- fjerner `CREATE` på `public` fra `PUBLIC`;
- giver `USAGE` på `public` til `anon` og `authenticated`;
- nulstiller ACL på de otte tabeller og viewet og giver kun SELECT;
- fjerner alle privilegier på de fem sequences;
- fjerner EXECUTE på `rls_auto_enable()` fra `PUBLIC`, `anon` og
  `authenticated`.

Kontrakten har ingen table write-grants, sequence-grants eller function EXECUTE
til applikationsroller. Før promotion skal den afstemmes med Supabases Data API-
indstillinger, ønsket `authenticated`-adfærd, owners og eventuelle default
privileges. RLS og grants er separate lag; begge skal fortsat testes.

## Særskilt review af `rls_auto_enable()`

### Observerede egenskaber

- `LANGUAGE plpgsql`, `SECURITY DEFINER`, owner `postgres` lokalt og i den
  tidligere katalogcapture;
- returnerer `event_trigger` og tager ingen SQL-argumenter;
- fast `search_path=pg_catalog`, hvilket er den korrekte sikre retning;
- input kommer fra servergenererede rækker i
  `pg_event_trigger_ddl_commands()` for CREATE TABLE-lignende DDL;
- dynamisk SQL bruger
  `format('alter table if exists %s enable row level security',
  cmd.object_identity)`;
- event triggeren `ensure_rls` er ikke med i baseline-draften.

`cmd.object_identity` er servergenereret og ikke et direkte brugerargument, så
den normale string-inputflade er begrænset. Funktionen reagerer dog bredt på
fremtidig DDL i `public`, kører som en privilegeret owner og sluger alle fejl i
en exceptionblok. Det sidste kan give falsk tryghed: en tabel kan blive oprettet,
mens RLS-aktivering kun fejler til loggen.

### EXECUTE og direkte probe

Før ACL var `proacl=NULL`, hvilket betyder default EXECUTE til `PUBLIC` og
dermed også `anon`/`authenticated`. En direkte invocation som `anon` kunne ikke
gå ind i event-trigger-context og fejlede uden write. Det reducerer den direkte
udnyttelsesvej, men gør ikke en offentlig `SECURITY DEFINER`-funktion til en god
baselinekontrakt. Efter det lokale ACL-udkast havde ingen af de tre offentlige
roller EXECUTE.

### Anbefaling: fjern før promotion

Behovet for `SECURITY DEFINER` er ikke bevist i denne baseline:

- event triggeren er allerede udeladt;
- alle otte tabeller får RLS eksplicit i den deterministiske SQL;
- CI/replaychecks kan håndhæve RLS uden skjult DDL-automatik;
- funktionen giver ekstra owner-, ACL- og portabilityrisiko uden aktiv funktion.

Hvis automatisk RLS senere bliver et eksplicit krav, bør den designes separat:
dedikeret non-login owner med mindst mulige privilegier, ikke-eksponeret schema,
ingen PUBLIC EXECUTE, præcis event-trigger-scope og mutationstest, der beviser at
en aktiveringsfejl stopper DDL i stedet for blot at logge den.

## Reproduktion og filbaserede værn

Replay kræver en lokalt installeret PostgreSQL 17.10-toolchain med
`moddatetime`:

```bash
node tools/replay-project-baseline-local.mjs \
  --toolchain /lokal/postgresql-17.10 \
  --work-dir /privat/område-uden-for-repository \
  --output supabase/baseline/local-replay-result.json
```

Det committede resultat kan verificeres uden PostgreSQL, private filer eller
credentials:

```bash
npm run check:local-baseline-replay
npm run test:local-baseline-replay
```

Mutationstesten beviser non-zero exit for productionforbindelsesclaim,
ikke-deterministisk schema, schemaforskel, manglende RLS, uventet write-adgang,
offentlig EXECUTE efter ACL, ændret baselinehash, write-grant i ACL og lokal
clusterfil i repository'et.

## Stopgrænse og næste gate

Baseline-draften er fortsat ikke en migration, og ACL-udkastet er ikke
produktionsgodkendt. Ingen PR eller merge er del af denne gate.

Næste afgrænsede gate bør:

1. tage en eksplicit produkt-/sikkerhedsbeslutning om at fjerne
   `rls_auto_enable()`/`ensure_rls` fra den promoverede baseline;
2. beslutte om `deals` skal have samme SELECT-policyrolle som de øvrige tabeller;
3. færdiggøre owner-, grants- og default-privilege-kontrakten;
4. gentage database-replay og, når container-runtime er tilgængelig, køre et
   separat full-service Supabase API/Auth/PostgREST-smoketest;
5. stoppe igen før migrationspromotion, `db push`, `migration repair` eller
   remote historikafstemning.
