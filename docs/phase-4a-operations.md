# Fase 4A — filbaseret redaktionel drift

> Gældende driftsgrænse, 2026-07-20. Fase 4A validerer og sammenligner filer read-only. Den skriver ikke til Supabase, genererer ikke SQL og publicerer ikke levende research.

## Sikkerhedsgrænse

- Levende inbox-, revisions- og overlayfiler skal ligge i en privat mappe **uden for dette offentlige repository**. `editorial-private/` er desuden git-ignoreret som ekstra værn, men er ikke den anbefalede lagringsplacering.
- Kun syntetiske fixtures under `test/fixtures/phase-4/` må ligge i repoet. De indeholder ingen levende research, credentials eller produktionsidentiteter.
- Værktøjerne accepterer almindelige filer, ikke symlinks, og håndhæver byte-, dybde- og itemgrænser, prototype-key-filter samt credentialmønstre.
- `tools/editorial-dry-run.mjs` læser kun inbox og ét komplet snapshot. Den blander aldrig snapshot og REST og har ingen Supabase-/netværks- eller skriveimports.
- Fase 4A har ingen apply-kommando. `DELETE` er ikke en tilladt operation. Alexander er eneste tilladte menneskelige approver i kontraktversion 1.0.0.

## Kontrakter og kommandoer

De maskinlæsbare kontrakter i `schemas/` er kanoniske for implementeringen. Dokumenterne i fase 4-planen er beslutningshistorik.

```bash
# Inbox mod schema og domæneregler
npm run verify:editorial -- --type inbox --file /privat/sti/inbox.json

# Read-only diff mod et publiceret snapshot
node tools/editorial-dry-run.mjs \
  --inbox /privat/sti/inbox.json \
  --snapshot data/arkiv.json

# Append-only NDJSON; den nye fil skal bevare gammel fil byte-for-byte som præfiks
npm run verify:editorial -- \
  --type ledger \
  --file /privat/sti/revisions.ndjson \
  --previous /privat/sti/revisions-forrige.ndjson

# Deterministisk coverage; output skrives til stdout, ikke af værktøjet til disk
node tools/build-coverage-backlog.mjs \
  --snapshot data/arkiv.json \
  --overlay /privat/sti/coverage-overlay.json

# Verificér et eksisterende manifest og alle dets artifacts
node tools/verify-backup-manifest.mjs \
  --manifest /privat/backup/manifest.json
```

`tools/build-backup-manifest.mjs` kan inventere en eksisterende eksport og udskriver et manifest til stdout. Operatøren skal give eksplicit metadata; værktøjet henter ikke metadata, eksporterer ikke data og skriver ikke manifestet. Et manglende obligatorisk artifact giver `status: failed` og non-zero exit.

## Kendte kontraktgrænser (dry-run og NULL)

- **Felter uden snapshot-dækning:** allowlisten tillader enkelte kolonner, som det publicerede snapshot ikke medtager (fx `companies.website`/`description` og investor-biofelter). En update af dem blokerer korrekt med `PRECONDITION_FIELD`, fordi preconditions ikke kan efterprøves mod en baseline, der mangler feltet. Skal de redigeres via dette workflow, skal Trykpressens snapshot-query først udvides — indtil da hører de til manuel kuratering.
- **Entydig NULL-disciplin:** på **update** udtrykkes "ryd feltet" altid med `action: clear` (`set` med `value: null` afvises med `SET_NULL_USE_CLEAR`); på **insert** er `set` med `value: null` den legitime startværdi, og `clear` afvises (`INSERT_CLEAR`). Dermed kan diffs og revisioner altid skelne "sat til værdi", "ryddet" og "ukendt ved oprettelse".

## Coverage og NULL

Backloggen afledes deterministisk af snapshot-hash, stabile database-id'er og versionsstyrede regler. Manglende CVR, kategori, status, kilde, efterliv, afsnit, søgt beløb eller ejerandel udtrykkes som `observed_state: unknown`; fravær bliver aldrig automatisk til “findes ikke”. Manuelle workflowvalg ligger i et separat privat overlay og kan ikke ændre generatorens observation.

Backloggen er et arbejdsredskab og blokerer ikke site-deploy. Datavalideringens egentlige blockers er fortsat deploy-gaten.

## Backupgrænse

Manifestet skelner mellem:

- `data_export`: de otte tabeller, `investor_status`-viewet og migrationslisten, med hash, bytes, row count, restoreorden og referentiel kontrol;
- `full_recovery_set`: ovenstående plus schema-DDL, policies og grants.

En sekventiel REST-/JSON-eksport er ikke transaktionelt konsistent og er ikke i sig selv et fuldt database-recovery-set. `restore_rehearsed: false` må ikke omtales som bevist rollback.

Den seneste private eksportmappe `backup/2026-07-20/` blev 2026-07-20 inventeret read-only: ni data/view-artifacts blev fundet, men `schema-migrations.txt` mangler. Builderen gav derfor korrekt `status: failed`. Ingen filer i eksporten blev ændret. Først en komplet, hashet eksport med migrationsliste kan få `complete`; DDL/policies/grants og isoleret restore rehearsal udestår fortsat.

## Deploy-gate og private filer

`npm run verify` kører fase 4A's syntetiske kontrakt- og mutationstests, men scanner aldrig en privat driftsmappe. En ufærdig levende inbox kan derfor ikke blokere en almindelig site-publicering. Levende filer kontrolleres eksplicit med `verify:editorial`.

Fase 4A kræver ingen Supabase-credentials eller manuel databasehandling. Frisk eksport, schema-/policy-/grant-dump, restore rehearsal og enhver fremtidig produktionsskrivning kræver særskilt autorisation og hører ikke til denne fase.

## Aktuel snapshotbaseline

Tallene her er aflæst direkte fra `data/arkiv.json` trykt 2026-07-20: 325 virksomheder, 329 pitches, 300 investor-relationer, 18 investorer, 11 sæsoner, 61 panelrelationer, 22 events, 65 kilder og CVR på 155 virksomheder. Ladybox-sammenlægningen er allerede del af denne baseline og må ikke genafspilles som inbox eller migration.
