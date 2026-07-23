# Recovery/restore-runbook

> Dateret 2026-07-22. Runbooken er en plan, ikke bevis for gennemført restore.
> Trin markeret **MANUEL/KRÆVER CREDENTIALS** er ikke udført i denne branch.

## 1. Dokumenteret fakta og recovery-mål

**Dokumenteret fakta:** Produktionen har ét Supabase-projekt og en statisk
Trykpresse-publicering. Private JSON-eksporter bevarer public-data. Repository'et
har nu en lokalt replayet project-only promotion candidate, men fortsat ingen
productiongodkendt migrationsbaseline eller dokumenteret fuld datarestore-
rehearsal. RPO og RTO er ikke målt eller besluttet.

**Anbefalet mål:** Recovery skal bevise fire uafhængige egenskaber:

1. schema og sikkerhedsgrænser kan genskabes deterministisk;
2. data kan indlæses komplet uden relationstab eller typecoercion;
3. den offentlige læsevej virker, mens anon/auth writes fortsat afvises;
4. beviset kan gentages uden første restore mod produktion.

## 2. Recovery-assets

| Lag | Nuværende dokumenterede asset | Dækker ikke |
|---|---|---|
| Kode/publicering | Git + statisk Netlify-output | Live databasehistorik |
| Public snapshot | `data/arkiv.json` i builds/deploys | Fuld DDL, grants, sequences og alle metadata |
| Redaktionel data | Private JSON-eksporter i vault | Bevist full-fidelity restore |
| Schemahistorik | 16 navne/versioner i live historik + vaultnoter | Komplet SQL i repo |
| Platformbackup | Afhænger af Supabase-plan/konfiguration | Storage-objekter og custom role passwords |
| Read-only baselinegates | 16 statementfingeraftryk, katalogcapture og privat schema-only dump med objektparitet | En replaybevist/promoveret baseline eller restore rehearsal |
| Project-only baseline-draft | Deterministisk SQL-draft og inventory med fuld project-objectparitet | Replaybevis, ACL-kontrakt, migrationspromotion og restore rehearsal |
| Lokal database-replay | To tomme PostgreSQL 17.10-clusters, identisk schemahash, RLS/ACL-/write-tests og syntetisk fixture | Full-service Supabase-test, productiongodkendt ACL, datarestore og migrationspromotion |
| Promotion candidate | To nye tomme clusters, identisk hash, integreret ACL, nul project-/SECURITY DEFINER-funktioner og 48/48 afviste writes | Auth/PostgREST-test, `deals`-rollebeslutning, uafhængigt review og migrationshistorikafstemning |

Hvis Storage senere tages i brug, skal objekter og metadata have en særskilt
backup-/restore-plan; databasebackup alene gendanner ikke objekterne.

## 3. Incident-start — ingen restore endnu

**Anbefalet procedure:**

1. Stop alle ikke-nødvendige writes og notér incidenttid, observeret fejl og
   seneste kendte gode publicering.
2. Bevar evidens: database-/platformstatus, migrationshead, aktuel git-SHA,
   snapshotdato og backupmanifest. Overskriv ikke den mulige kildebackup.
3. Klassificér hændelsen: kode/publicering, datarækker, schema/privilegier,
   credentials eller platform.
4. Vælg recovery point ud fra verificerede hashes og tidsstempler; antag ikke,
   at “seneste mappe” er komplet.
5. Udpeg en operatør og en separat reviewer. Skriv det forventede target-project
   ID ned før nogen credentialed kommando.
6. Gendan først i et isoleret target. Produktion er aldrig første restore-target.

## 4. Target-sikkerhed

Før restore skal operatør og reviewer bekræfte:

- target er lokal, unlinked Supabase eller et udtrykkeligt godkendt throwaway-
  projekt;
- target-project ID er ikke `upaxzfytumsijnbhjihd`;
- ingen produktionsservice-role eller databasepassword findes i shellhistorik,
  logfiler, git eller artefaktmapper;
- target er tomt eller må destrueres;
- netværks- og write-adgang er begrænset til target;
- rå dumps og restored data behandles privat og slettes efter retention-reglen.

`supabase db reset --linked`, `db push` og `migration repair` er forbudt i en
rehearsal. Et lokalt `supabase db reset` må kun køres efter en eksplicit
unlinked-target-kontrol.

## 5. Anbefalet restore-rækkefølge

1. Verificér backupmanifest, checksums, bytes, rækkeantal og completeness marker.
2. Opret den isolerede database med samme understøttede PostgreSQL-majorversion.
3. Etablér kun de projekt-ejede extensions, som baseline kræver.
4. Replay den reviewede SQL-baseline/migrationer fra tom database.
5. Verificér schemahash, view, funktioner, triggers, RLS, policies, grants og
   default privileges før dataindlæsning.
6. Indlæs data i dokumenteret FK-rækkefølge:
   `seasons → investors → panel_memberships → companies → deals →`
   `deal_investors → company_events → sources`.
7. Bevar identity-/PK-værdier. Justér og kontroller sequences efter import;
   næste genererede ID skal ligge over eksisterende maksimum.
8. Genskab ikke `investor_status` fra JSON som tabel; det er et view og skal
   komme fra migrationen. JSON-versionen bruges kun til paritetskontrol.
9. Kør alle integritets-, sikkerheds- og applikationschecks nedenfor.
10. Gem et privat drill-manifest med inputhashes, målmiljø, start/slut,
    operatør/reviewer, kommando-versioner og resultater. Destroy target efter
    godkendt evidens og verificér sletningen.

## 6. Verifikation efter restore

### Schema og sikkerhed

- migrationshead og filinventar stemmer;
- normaliseret schema-diff har ingen uforklarede forskelle;
- alle otte public-tabeller har RLS aktiveret;
- `investor_status` er `security_invoker`;
- promotion-inventoryet har nul project- og SECURITY DEFINER-funktioner, og en
  ny function-probe får ikke default PUBLIC/anon/auth EXECUTE;
- SELECT virker med offentlig rolle på tilsigtede objekter;
- INSERT, UPDATE, DELETE og TRUNCATE afvises med anon/auth;
- policies og grants matcher den godkendte baseline, ikke platformdefaults;
- Security Advisor har ingen blockers; performancefund er reviewet, ikke
  automatisk “fikset”.

### Data og relationer

- rækkeantal pr. tabel matcher backupmanifestet;
- PK/UNIQUE/FK/CHECK er valideret;
- ingen orphan `sources` for nogen tilladt `entity_type`;
- ingen orphan deals, investorrelationer, panelrelationer eller events;
- generated `deals.aftale` matcher `beloeb_modtaget IS NOT NULL`;
- NULL-tilstande for ukendt afsnit, beløb, ejerandel, CVR og kategori bevares;
- eventdato og `date_precision`, confidence, slugs og CVR består de eksisterende
  publiceringsregler;
- identity/sequences kan generere en ny ID i en transaktion, der rulles tilbage.

### Produktkontrakt

- generér et privat snapshot fra restore-targetet;
- kør `validate-data`, Trykpressen og resten af `npm run verify` mod snapshottet;
- sammenlign nøgletal og kendte runde-7/Ladybox-regressioner med manifestet, ikke
  med gamle prompttal;
- kontroller et udsnit af virksomhed, investor, sæson, register og kildelinks.

## 7. Konkret plan for at bevise restore

### Bevis A — filværn (udført i denne branch)

Kør checker og mutationstests. Resultatet beviser format-/historikværn og at
fundamentet ikke påstår replayability. Det beviser **ikke** database-restore.

### Bevis B — syntetisk lokal schema-replay (database-lag udført; ingen production-credentials)

Promotion-kandidaten er nu replayet fra tom database i en unlinked lokal
PostgreSQL-stack med en lille syntetisk fixture, der dækker:

- virksomhed med to pitches og flere investorer;
- no-deal med legitime NULL-felter og ukendt afsnit;
- company event med to kilder og måneds-/års-præcision;
- source uden URL;
- identity/sequence og `ON DELETE CASCADE` i rollbacket transaktion.

Mutér hver klasse: manglende migration, ændret constraint, orphan source,
forkert row count/hash, afkortet fil, dublet-ID, falsk `complete`, disabled RLS,
for bred write-policy/grant og sekvens bag max-ID. Hver mutation skal give
non-zero exit og altid gendannes i tempområdet.

Schema-, ACL-, RLS-, SELECT-, trigger-, view-, function-default- og negative
write-delen er nu bevist i to promotion-clusters ud over de to tidligere
draft-clusters. En fuld datarestore med sekvensmutationer, manifest/corruption-
fixtures og hele Supabase-service-stacken mangler fortsat.

### Bevis C — privat snapshot-restore (**MANUEL/KRÆVER CREDENTIALS**)

Tag en frisk, konsistent logisk schema+dataeksport med checksums fra produktion
uden writes. Restore den i et nyt throwaway-projekt eller en godkendt lokal
database. Kør hele §6, dokumentér tidsforbrug og datadiff, og få en anden part
til at reviewe evidensen. Ingen rå produktionsdata eller credentials committes.

### Bevis D — periodisk rehearsal (**MANUEL BESLUTNING**)

Fastlæg RPO/RTO og kadence. Gentag Bevis C efter væsentlige schemaændringer og
minimum med en aftalt periodisk rytme. En backup er først “verificeret”, når dens
konkrete manifest er restore-testet eller dækket af en dokumenteret stikprøve.

## 8. Roll-forward eller rollback i en reel hændelse

**Anbefalet beslutningsregel:** Foretræk en ny, reviewet forward-fix ved mindre
schemafejl. Brug restore ved korruption/tab, ukendt tilstand eller når forward-fix
ikke kan bevises sikkert. Git rollback og database rollback er forskellige lag;
et kode-revert ruller ikke data tilbage.

Før en senere production-restore kræves eksplicit godkendelse, vedligeholdelses-
vindue, frisk bevaring af den fejlramte tilstand, target-/recovery-point-dobbelt-
kontrol og kommunikationsplan. Efter restore: read-only verifikation først,
derefter kontrolleret genåbning af writes og ny statisk publicering som separat
handling. Denne branch autoriserer ingen af disse handlinger.
