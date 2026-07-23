# Project-only databasebaseline — promotion candidate

> Dateret 2026-07-23. Branch-base:
> `bd15a8a24403599271908efe16245807b6afed99`. Arbejdet er udelukkende lokalt.
> Ingen productionforbindelse, Supabase-write, `db pull`, `db push`,
> `migration repair`, remote replay eller migrationshistorikafstemning er udført.

## Status og konklusion

**Dokumenteret fakta:** En deterministisk promotion candidate er udledt fra den
uændrede, lokalt replayede draft og kørt i to nye, tomme PostgreSQL 17.10-
clusters. Begge replays lykkedes og gav samme normaliserede schemahash:

```text
1df6d2524a2bee99ac98bf14e7f65798cc59fcdaded3c3222ddccfaec4df76e9
```

Kandidaten har fuld paritet med det forventede project-inventory, bortset fra
den ene tilsigtede forskel til production-capturen: `rls_auto_enable()` er
fjernet. Den har nul project-funktioner, nul `SECURITY DEFINER`-funktioner,
8/8 RLS-tabeller, 8 policies og en integreret, eksplicit ACL-kontrakt.

Kandidaten er **ikke en migration og er ikke anvendt på production**. Den må
ikke overskrive `project-schema-baseline.draft.sql`, bruges til remote replay
eller få migrationshistorikken markeret som afstemt. Den historiske draft og
dens tidligere replayresultat bevares som evidens for beslutningsforløbet.

## Filer og provenance

- `supabase/baseline/project-schema-baseline.promotion-candidate.sql` —
  sanitiseret candidate, SHA-256
  `16f7ef023e691f9264ec17256edcf609f33b17a3af9422a5e61183ffd98e4ac5`;
- `supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json`
  — forventet objektflade, stopstatus, ACL- og policykontrakt;
- `supabase/baseline/promotion-candidate-local-replay-result.json` —
  sanitiseret resultat fra de to lokale replays;
- `tools/build-project-baseline-promotion-candidate.mjs` — deterministisk
  transformation fra den committede draft;
- `tools/replay-project-baseline-local.mjs --promotion` — genbruger den
  eksisterende isolationsrunner med promotion-specifikke assertions;
- filbaserede checks og mutationstests i `tools/check-baseline-promotion-*` og
  `tools/test-baseline-promotion-*`.

Generatoren læser kun committede filer. Den gamle draftfingerprint er fortsat:

```text
cd3e13b826e278ced948d96fb75157834647dabeedb5654b20956bdbe2076e57
```

Rå schema-only dumps, PostgreSQL-logs og privat manifest ligger uden for
repository'et. De committede filer indeholder ingen private paths,
databasecredentials eller connectionmateriale.

## Tilsigtet schemaændring

`public.rls_auto_enable()` er ikke ACL-hardnet i kandidaten; den er fjernet.
Beslutningen bygger på følgende verificerede forhold:

- event triggeren `ensure_rls` var allerede udeladt af project-only draften;
- alle otte projekttabeller aktiverer RLS eksplicit i baseline-SQL;
- funktionen var `SECURITY DEFINER`, men havde ingen aktiv funktion i den
  afgrænsede baseline uden event triggeren;
- den tidligere lokale replaygate viste PostgreSQLs default `PUBLIC EXECUTE` og
  dermed en unødvendig privilegeret flade;
- filchecks og replaytester kan kontrollere RLS direkte uden skjult DDL-
  automatik.

Den forventede promotion-diff mod den sanitiserede production-capture er derfor:

| Objektklasse | Production-capture | Candidate | Reviewet forskel |
|---|---:|---:|---|
| Funktioner | 1 | 0 | `rls_auto_enable()` fjernet |
| Tabeller | 8 | 8 | Ingen |
| Kolonner | 59 | 59 | Ingen |
| Sequences | 5 | 5 | Ingen |
| Views | 1 | 1 | Ingen |
| Triggers | 3 | 3 | Ingen |
| Indeks | 7 | 7 | Ingen |
| Constraints | 26 | 26 | Ingen |
| Policies/RLS-tabeller | 8/8 | 8/8 | Ingen |

## Integreret ACL-kontrakt

ACL-kontrakten er en del af promotion-SQL’en og udføres efter schema, RLS og
policies. Den opretter ingen roller og navngiver ingen owner. Targetet skal på
forhånd have Supabases runtime-roller `anon` og `authenticated`.

Kontrakten:

1. fjerner alle schemarettigheder på `public` fra `PUBLIC`, `anon` og
   `authenticated` og giver kun `USAGE` tilbage til de to runtime-roller;
2. nulstiller rettigheder på præcis de otte project-tabeller og
   `investor_status`, og giver kun SELECT til `anon` og `authenticated`;
3. fjerner alle rettigheder på de fem project-sequences fra `PUBLIC`, `anon` og
   `authenticated`;
4. fjerner defaultrettigheder til fremtidige tabeller/sequences i `public` fra
   `PUBLIC`;
5. fjerner den aktuelle migrationsowners globale default `PUBLIC EXECUTE` på
   fremtidige funktioner.

Det sidste punkt er bevidst globalt for **den rolle, som udfører SQL’en**.
PostgreSQL kan ikke ophæve den globale indbyggede function-default med et
schema-afgrænset REVOKE. Den første lokale replay opdagede netop dette: en
`IN SCHEMA public`-variant efterlod PUBLIC/anon/authenticated EXECUTE på en
syntetisk ny funktion. Replayet stoppede, kandidaten blev rettet, og de to
endelige replays beviste derefter nul EXECUTE for alle tre grantees. SQL’en
bruger ikke `FOR ROLE` og hardcoder derfor ingen miljøspecifik owner.

RLS og grants er fortsat separate sikkerhedslag. SELECT-grant er ikke i sig selv
row visibility, og manglende write-grants erstatter ikke RLS. Replayet tester
begge lag.

## `deals`-policyen — særskilt undersøgelse

### Hvad der kan bevises

- Det private, read-only productiondump og den sanitiserede katalogcapture viser
  `CREATE POLICY "Public read access" ... FOR SELECT TO anon USING (true)`.
- De 16 registrerede migrationsstatements begynder efter, at `deals` allerede
  fandtes. De opretter policies på de senere normaliserede tabeller, men ingen
  af dem dokumenterer oprindelsen eller rationalet for den eksisterende
  `deals`-policy.
- Migrationsstatementet `create_investor_status_view_and_policies` beskriver
  den generelle intention som “læs for alle, skriv for ingen” og opretter de fem
  nye policies uden eksplicit rolle, dvs. til `public`.
- Vaultens database- og sikkerhedsdokumentation beskriver den offentlige
  produktadgang som `anon = kun SELECT`.
- Repositoryets browser- og Trykpresseklient bruger public anon-token og har
  ingen authenticated login-/læseflow.

### Hvad der ikke kan bevises

Ingen gennemgået beslutning, migration eller produkttekst forklarer, hvorfor
`authenticated` skal kunne se syv tabeller, men ikke `deals`. Den nuværende
asymmetri kan være tilsigtet legacyadfærd eller en historisk inkonsistens. Et
rollevalg kan derfor ikke udledes sikkert.

### Kandidatens handling

Adfærden beholdes uændret: `anon` ser fixture-rækken i `deals`, mens
`authenticated` kan udføre SELECT-statementet, men RLS returnerer nul rækker.
Det markeres som en **åben produkt- og sikkerhedsbeslutning**. En senere ændring
kræver eksplicit beslutning og separat migration; denne gate gætter ikke.

## Lokal replay og isolation

De to replays brugte samme PostgreSQL 17.10-toolchain som den foregående gate:
`postgres`, `psql`, `pg_dump`, `initdb` og `pg_ctl` var alle 17.10;
`moddatetime` 1.0 blev etableret som eksplicit precondition i schemaet
`extensions`.

Hvert run:

1. oprettede et nyt `initdb`-cluster uden public projektrelationer;
2. lyttede kun på en midlertidig Unix-socket (`listen_addresses=''`);
3. fjernede alle connection- og Supabasevariabler fra child-processmiljøet;
4. oprettede lokale, non-login `anon`/`authenticated`-roller og
   `extensions.moddatetime`;
5. replayede den integrerede candidate én gang med `ON_ERROR_STOP`;
6. beviste nul indlejrede tabelrækker og tog et schema-only dump uden owners og
   privileges;
7. sammenlignede objekt-for-objekt med promotion-inventoryet;
8. kørte ACL-, RLS-, SELECT-, write-, view-, generated-column- og triggertests;
9. dumpede igen og beviste uændret privilege-fri schemaflade;
10. stoppede serveren og slettede cluster- og socketmapperne.

Ingen project ref, linked state, credential eller netværksforbindelse blev brugt.
PostgreSQL-database-laget er testet; Auth, PostgREST, Storage, Realtime og gateway
er ikke testet i denne gate.

## Verificerede resultater

| Test | Resultat |
|---|---:|
| Uafhængige tomme clusters | 2/2 |
| Identiske normaliserede schemahashes | 2/2 |
| Forventet promotion-inventory | Fuld match |
| Project-funktioner | 0 |
| `SECURITY DEFINER`-funktioner | 0 |
| Default function EXECUTE-probe | PUBLIC/anon/authenticated = false |
| RLS-aktiverede tabeller | 8/8 |
| Policies | 8/8 |
| SELECT-statements | 18/18 lykkedes |
| Synlige relationer som anon | 9/9 |
| Synlige relationer som authenticated | 8/9; `deals` = 0 rækker |
| INSERT/UPDATE/DELETE-probes | 48/48 afvist |
| Uventede table-/sequence-/schemarettigheder | 0/0/0 |
| Data-/credential-/owner-signaler i schema-only dump | 0/0/0 |

De 14 lokale owners i kataloget er den lokale cluster-owner `postgres` som en
normal følge af replayet. Candidate-SQL’en indeholder nul OWNER-statements og
fremsætter ingen production-ownerbeslutning.

## Filbaserede checks og mutationstests

```bash
npm run check:baseline-promotion-candidate
npm run test:baseline-promotion-candidate
npm run check:baseline-promotion-replay
npm run test:baseline-promotion-replay
```

Candidate-testen blokerer ni mutationer, herunder genindført function,
SECURITY DEFINER, write-grant, manglende default function-REVOKE, ændret
`deals`-policy, OWNER, indlejret data, falsk productionstatus og privat artefakt.
Replaytesten blokerer ti mutationer, herunder productionforbindelse,
schemahash-drift, uventet objektdiff, manglende RLS, project-funktion,
PUBLIC EXECUTE, write-adgang, gættet policybeslutning, inputhash-drift og lokal
databasefil i repository'et. Alle mutationer køres i tempfixtures og gendannes.

## Resterende blockers før baselinepromotion

1. Tag en eksplicit produkt-/sikkerhedsbeslutning om `authenticated` og
   `deals`; indtil da skal den nuværende policy bevares.
2. Få en uafhængig reviewpart til at gennemgå candidate-SQL, ACL-scope,
   default-privilege-semantik og replayevidens.
3. Kør et separat unlinked full-service Supabase-smoketest, så PostgREST/Auth-
   rolleovergangen og Data API-adfærden bevises; database-laget alene er ikke nok.
4. Afstem den endelige owner-/migration-runner-model. Kandidaten navngiver
   bevidst ingen owner.
5. Planlæg migrationshistorikafstemning som en særskilt, autoriseret
   production-write med backup, reviewer og stopkontrol.
6. Gennemfør fortsat en datarestore-rehearsal med privat backupmanifest;
   schema-replay er ikke et bevis for fuld recovery.

Indtil alle blockers er løst, forbliver filen en **promotion candidate — not
applied**, og `supabase/migrations/` forbliver uden baseline-SQL.
