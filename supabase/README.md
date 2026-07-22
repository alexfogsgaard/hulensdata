# Supabase-migrationer og recovery

Denne mappe er fundamentet for versionsstyrede databaseændringer. Den ændrer ikke
live Supabase og indeholder ingen credentials eller produktionsdata.

## Aktuel status

- `migration-inventory.json` er et read-only inventar af den eksterne
  migrationshistorik pr. 2026-07-22.
- `baseline-capture-review.json` er sanitiseret metadata fra den private
  read-only capture; den indeholder fingerprints og sikkerhedsflag, ikke SQL.
- `schema-dump-review.json` er sanitiseret inventory og katalogdiff fra ét
  privat PostgreSQL 17 schema-only dump; den indeholder ingen dump-SQL,
  credentials eller private paths.
- `baseline/project-schema-baseline.draft.sql` er en deterministisk,
  project-only schema-draft. Dens inventory beviser objektparitet og
  eksklusioner; draften er ikke replayet, en migration eller autoriseret til
  remote brug.
- `baseline/local-replay-result.json` dokumenterer to isolerede PostgreSQL
  17.10-replays og sikkerhedstest uden private paths eller credentials.
- `baseline/project-schema-acl.contract.draft.sql` er et least-privilege-udkast,
  der kun er anvendt lokalt. Det er ikke en migration eller productiongodkendt.
- `migrations/` indeholder endnu ingen SQL-migrationer.
- Baseline er derfor fortsat **ikke replaybevist** fra repository'et.

Det er bevidst. Tomme placeholder-filer med de historiske versionsnumre ville få
lokal og ekstern historik til at se afstemt ud uden at kunne genskabe schemaet.

## Foreslået struktur

```text
supabase/
├── README.md
├── migration-inventory.json
├── baseline/
│   ├── project-schema-baseline.draft.sql
│   ├── project-schema-baseline.draft.inventory.json
│   ├── project-schema-acl.contract.draft.sql
│   └── local-replay-result.json
├── config.toml                    # senere: genereret lokalt, uden secrets
├── migrations/
│   ├── README.md
│   └── YYYYMMDDHHMMSS_beskrivende_navn.sql
└── tests/
    └── database/                  # senere: lokale SQL-/kontrakttests
```

Fremtidige migrationsfiler oprettes med Supabase CLI, eksempelvis
`supabase migration new revoke_public_write_privileges`. Navnet er lille
snake_case; CLI'en leverer tidsstemplet. Én fil skal beskrive én logisk ændring
og indeholde før-/efterkontrol samt rollback-/recovery-noter i kommentaren.

Se [database-migrations-recovery.md](../docs/database-migrations-recovery.md)
for baseline-gates og [recovery-restore-runbook.md](../docs/recovery-restore-runbook.md)
for restore-flowet.

## Lokale kontroller

```bash
npm run check:database-foundation
npm run test:database-foundation
npm run check:baseline-capture
npm run test:baseline-capture
npm run check:schema-dump-review
npm run test:schema-dump-review
npm run check:project-baseline-draft
npm run test:project-baseline-draft
npm run check:local-baseline-replay
npm run test:local-baseline-replay
```

Kontrollerne er filbaserede. De forbinder ikke til Supabase og kan ikke skrive
til produktion.
