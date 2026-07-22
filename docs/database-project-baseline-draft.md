# Project-only databasebaseline — filbaseret draft

> Dateret 2026-07-23. Branch-base:
> `14c53540d0d465745e41670b84a5462178fb9205`. Dette er en lokal, filbaseret
> gate. Ingen databaseforbindelse, replay, Supabase-write, migrationshistorik-
> afstemning, deploy eller promotion til migration er udført.

## Resultat og status

**Dokumenteret fakta:** Det verificerede private PostgreSQL 17 schema-only dump
er deterministisk reduceret til en sanitiseret, project-only SQL-draft. Draften
matcher alle hulensdata-objekter i `supabase/schema-dump-review.json` og
indeholder ingen tabelrækker, historisk DML, credentials, owners/grants,
platformschemaer, extension-DDL, event triggers, publication, migrationshistorik
eller forbindelsesoplysninger.

Draften er **ikke en migration og må ikke replayes endnu**. Den er bevaret som
`supabase/baseline/project-schema-baseline.draft.sql`; det maskinlæsbare
inventory ligger ved siden af. Headeren angiver provenance, eksplicitte
eksklusioner, eksterne forudsætninger og stopgrænsen.

**Anbefalet næste skridt:** Replay draften i en tom, unlinked PostgreSQL
17/Supabase-kompatibel lokal stack efter særskilt review af function/ACL-
kontrakten. Promotion til migrations-SQL kan først overvejes, når lokal replay,
normaliseret schemadiff og negative adgangstests er grønne.

## Metode og provenance

Generatoren læser kun to lokale input:

1. det private dump med SHA-256
   `b2b592e5e512878bd6c7f2e0dee5fa9b0b861c3d5749dcee8a4600c8e2bd059e`;
2. den committede, sanitiserede reviewfil
   `supabase/schema-dump-review.json`.

Den private sti lagres ikke i output. Generatoren parser `pg_dump`-sektionerne,
kræver en lukket allowlist af forventede `public`-objekter, normaliserer kun
linjeslutninger og trailing whitespace og skriver objekterne i en fast,
dependency-bevidst orden. Den bygger samme input to gange og stopper, hvis
bytes afviger. Ukendte eller manglende `public`-sektioner er blockers; de bliver
ikke lydløst droppet.

Reproducerbar generering kræver privat adgang til det verificerede dump og er
derfor en manuel maintainer-kommando, ikke en CI-afhængighed:

```bash
node tools/build-project-baseline-draft.mjs \
  --dump /privat/verificeret/schema-only.sql \
  --review supabase/schema-dump-review.json \
  --output supabase/baseline/project-schema-baseline.draft.sql \
  --inventory supabase/baseline/project-schema-baseline.draft.inventory.json
```

CI og `npm run verify` bruger alene den committede SQL-draft, inventory og
sanitiserede reviewfil. Ingen credentials eller private artefakter er nødvendige.

## Objektinventar

De 61 inkluderede `pg_dump`-objektsektioner giver følgende maskinelle
schemaflade. Kolonner inventariseres desuden separat, så den samlede
inventorysum er 126 poster uden at påstå 126 selvstændige databaseobjekter.

| Kategori | Antal | Indhold |
|---|---:|---|
| Tabeller | 8 | `companies`, `company_events`, `deal_investors`, `deals`, `investors`, `panel_memberships`, `seasons`, `sources` |
| Fysiske tabelkolonner | 59 | Fuld paritet med dump-reviewet |
| Sequences | 5 | Fire identity-sequences og `deals_id_seq` |
| View | 1 | `investor_status` med `security_invoker=true` |
| Funktion | 1 | `rls_auto_enable()` med `SECURITY DEFINER` og fast `pg_catalog` search path |
| Triggers | 3 | `set_updated_at` via `extensions.moddatetime(text)` |
| Selvstændige indeks | 7 | FK-, sæson-, aftale-, event- og sourceindeks |
| Constraints | 26 | PK, UNIQUE, CHECK og FK |
| RLS-policies | 8 | SELECT-policies |
| RLS-tabeller | 8 | RLS aktiveret eksplicit på alle tabeller |

Inventoryets lister og antal sammenlignes maskinelt med
`schema-dump-review.json`. Et manglende, ekstra eller omdøbt objekt gør checket
rødt.

## Dependency-rækkefølge

Draften har ni faste faser:

1. project-funktion;
2. tabeller, sequences, ownership mellem sequence/kolonne og default;
3. primary/unique constraints;
4. foreign keys;
5. selvstændige indeks;
6. security-invoker-view;
7. `updated_at`-triggers;
8. eksplicit RLS-aktivering;
9. SELECT-policies.

Rækkefølgen er strukturel, ikke bevis for replay. Særligt fase 1 og 7 har
eksterne sikkerheds-/runtimeforudsætninger, som næste gate skal etablere eller
ændre eksplicit.

## Eksklusioner og automatiske sikkerhedsværn

Draft og inventory afviser:

- `COPY FROM stdin`, top-level INSERT/UPDATE/DELETE/TRUNCATE og `setval`;
- private keys, `sb_secret_`-værdier, JWT'er, credential-URI'er og password-
  literals;
- OWNER, GRANT, REVOKE og custom-role-DDL;
- objekter/referencer i `auth`, `storage`, `realtime`,
  `supabase_migrations`, `graphql_public` og `pgbouncer`;
- `CREATE SCHEMA`, `CREATE EXTENSION`, plpgsql-extension-DDL, event triggers og
  publications;
- migrationshistorik, connection-URI'er, Supabase-hosts og project-ref-
  kandidater.

De præcis tre referencer til `extensions.moddatetime(text)` er en dokumenteret
ekstern dependency og den eneste allowlistede platformreference. Funktionskroppe
fjernes alene fra rækkedata-scannet, så legitim schemafunktionstekst ikke
fejlklassificeres som dumpede rows; credential- og miljescans kører på hele
filen.

## Bevidst bevarede risici og stopgrænse

1. `public.rls_auto_enable()` er `SECURITY DEFINER` og returnerer
   `event_trigger`. Selve event triggeren er udeladt. Funktionen er bevaret for
   objektparitet, men dens nødvendighed, executable ACL og portability skal
   afgøres før replay.
2. Owners/grants er udeladt som krævet. PostgreSQLs default EXECUTE på nye
   funktioner og Supabases rolle-/schema-defaults betyder, at draften ikke må
   anses som en komplet least-privilege-kontrakt.
3. De tre triggers kan ikke oprettes, før `extensions.moddatetime(text)` findes.
   Extension-DDL skal etableres separat og lokalt med en eksplicit allowlist.
4. Draften kopierer produktionsdefinitioner, inklusive brede SELECT-policies.
   Objektparitet er ikke bevis for ønsket fremtidig privilege-design.
5. Der er ikke kørt parser/restore i PostgreSQL. Statisk syntaks- og
   inventarkontrol beviser ikke runtime-kompatibilitet eller tom-database-replay.

Disse punkter er kodet i inventoryets `risk_gate`: lokal replay er påkrævet,
mens baselinepromotion og remote historikafstemning er `false`.

## Filbaserede checks og mutationstests

```bash
npm run check:project-baseline-draft
npm run test:project-baseline-draft
```

Checket validerer provenancehashes, stopheader, determinismeclaim, objectparitet,
dependency-rækkefølge, sikkerheds-/eksklusionsscans og replaygrænse.
Mutationstesten beviser non-zero exit for 13 checker-mutationer: top-level DML,
credential, GRANT, intern schema-reference, extension-DDL, event-trigger-DDL,
connectionreference, objektdrift, forkert faseorden, ændret draftfingerprint,
falsk replayautorisation, ændret source-review-fingerprint og credential i
inventory. Separate fixtures dækker COPY-data, sequence-value, custom role,
migrationshistorik og publication.
Alle mutationer udføres i et tempområde og gendannes.

## Næste lokale replay-gate

En separat branch bør gøre følgende uden production-credentials:

1. start en tom, unlinked PostgreSQL 17/Supabase-kompatibel lokal target og
   bevis target-identiteten før writes;
2. opret kun den nødvendige `moddatetime`-dependency;
3. vælg og dokumentér en least-privilege ACL for funktion, tabeller, sequences
   og view; review især om `rls_auto_enable()` overhovedet skal promoveres;
4. replay en arbejdskopi af draften, aldrig production og aldrig via `db push`;
5. dump target schema-only og sammenlign normaliseret project-scope med den
   verificerede reference;
6. test PK/UNIQUE/CHECK/FK, identity/sequence, generated column, view, triggers,
   RLS/policies samt positive SELECT og negative anon/auth writes;
7. destroy target og bevar kun sanitiseret testbevis;
8. stop igen før baselinepromotion, remote history alignment, `db push` eller
   `migration repair`.
