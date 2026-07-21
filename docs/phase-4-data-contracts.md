# Fase 4 — foreslåede datakontrakter

> Historisk kontraktforslag, 2026-07-16. De materialiserede filer i `schemas/` er fra 2026-07-20 den maskinlæsbare sandhed for fase 4A; indlejrede eksempler nedenfor forklarer beslutninger, men må ikke bruges i stedet for de faktiske schemas. Implementeringen ændrer ikke Supabase.
>
> **Revideret 2026-07-16 efter Fable-review** (se `docs/phase-4-fable-review.md`): insert-targets har fået `local_ref`, `supports` kan udtrykke helhedskilder, precondition-semantikken er entydig pr. batch, slugændringer kræver redirect, coverage-generatorens output er adskilt fra manuel status, og revisionsloggen anbefales som NDJSON.

## Fælles konventioner

- `schema_version` starter på `1.0.0`; breaking changes kræver nyt major-nummer og eksplicit migration af artefakter.
- Timestamps er UTC RFC 3339 med `Z`; domænedatoer er `YYYY-MM-DD` og følger eksisterende `date_precision`.
- Alle ids er strenge i workflowlaget. Eksisterende database-id'er transporteres som positive heltal i et eksplicit targetfelt.
- SHA-256 skrives som 64 lowercase hextegn og beregnes over rå bytes, ikke reparset JSON.
- `additionalProperties: false` er standard. Udvidelser kræver schema-version, ikke tavse felter.
- NULL må kun bruges, hvor kontrakten siger det. `unknown`, `not_applicable`, `known` og `blocked` er separate tilstande; manglende data er aldrig automatisk `false`.
- **Sammenligningssemantik:** `expected_before` sammenlignes med snapshottets værdi ved dyb strukturel lighed uden nogen typekoercion — tal er tal, strenge er strenge, `null` er kun lig `null`, og manglende felt er en valideringsfejl (ukendt felt), aldrig et implicit `null`. Snapshottet serialiserer numeriske kolonner som JSON-tal; kontraktværdier skal bruge samme type.
- **Actor-identitet er pseudonym:** `actor.id` skal være et kort holdnavn fra en aftalt liste (fx `alexander`, `codex`, `fable`, `system`) — aldrig e-mail, fulde navne på tredjeparter eller andre persondata.
- Ingen kontrakt må indeholde API-nøgler, cookies, Authorization-headere, build-hook-URL'er eller andre secrets. Validatorer skal aktivt secret-scanne artefakter (mønstre som `eyJ`, `apikey`, `authorization`, `service_role`) og fejle ved fund.
- Workflowfiler refererer til eksisterende `companies`, `deals`, `investors`, `seasons`, `company_events` og `sources`; de kopierer ikke hele produktionsrækker som en ny sandhed.

## Editorial inbox

Inboxen er en kø af afgrænsede forslag. Hver operation har target, precondition, foreslået ændring og evidens. `accepted` betyder redaktionelt godkendt — ikke at ændringen er skrevet til produktion.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hulensdata.dk/schemas/editorial-inbox-1.0.0.json",
  "title": "Hulens Data editorial inbox",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "inbox_id", "created_at", "baseline", "status", "operations"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "inbox_id": { "type": "string", "format": "uuid" },
    "created_at": { "type": "string", "format": "date-time" },
    "created_by": { "$ref": "#/$defs/actor" },
    "baseline": {
      "type": "object",
      "additionalProperties": false,
      "required": ["snapshot_sha256", "snapshot_date", "git_sha"],
      "properties": {
        "snapshot_sha256": { "$ref": "#/$defs/sha256" },
        "snapshot_date": { "type": "string", "format": "date" },
        "git_sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" }
      }
    },
    "status": { "enum": ["new", "triaged", "in_review", "accepted", "rejected", "blocked"] },
    "review": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "required": ["reviewer", "reviewed_at", "decision", "reason"],
      "properties": {
        "reviewer": { "$ref": "#/$defs/actor" },
        "reviewed_at": { "type": "string", "format": "date-time" },
        "decision": { "enum": ["accepted", "rejected", "blocked"] },
        "reason": { "type": "string", "minLength": 1, "maxLength": 2000 }
      }
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "maxItems": 200,
      "items": { "$ref": "#/$defs/operation" }
    }
  },
  "$defs": {
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "actor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "id"],
      "properties": {
        "kind": { "enum": ["human", "agent", "system"] },
        "id": { "type": "string", "minLength": 1, "maxLength": 120 }
      }
    },
    "target": {
      "type": "object",
      "additionalProperties": false,
      "required": ["entity_type", "record_id"],
      "properties": {
        "entity_type": { "enum": ["company", "deal", "investor", "season", "company_event", "source", "deal_investor", "panel_membership"] },
        "record_id": { "type": ["integer", "null"], "minimum": 1 },
        "local_ref": { "type": ["string", "null"], "pattern": "^new:[a-z0-9][a-z0-9-]{0,60}$" },
        "secondary_id": { "type": ["integer", "null"], "minimum": 1 },
        "secondary_local_ref": { "type": ["string", "null"], "pattern": "^new:[a-z0-9][a-z0-9-]{0,60}$" },
        "slug": { "type": ["string", "null"], "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" }
      }
    },
    "source_proposal": {
      "type": "object",
      "additionalProperties": false,
      "required": ["source_name", "source_url", "confidence", "supports"],
      "properties": {
        "source_name": { "type": "string", "minLength": 1, "maxLength": 300 },
        "source_url": { "type": ["string", "null"], "format": "uri", "pattern": "^https?://" },
        "source_date": { "type": ["string", "null"], "format": "date" },
        "confidence": { "enum": ["confirmed", "likely", "uncertain"] },
        "supports": { "type": "array", "uniqueItems": true, "items": { "type": "string", "minLength": 1, "maxLength": 80 } },
        "note": { "type": ["string", "null"], "maxLength": 2000 }
      }
    },
    "change": {
      "type": "object",
      "additionalProperties": false,
      "required": ["field", "action", "expected_before", "value"],
      "properties": {
        "field": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
        "action": { "enum": ["set", "clear"] },
        "expected_before": {},
        "value": {}
      }
    },
    "operation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["operation_id", "kind", "target", "reason", "changes", "sources"],
      "properties": {
        "operation_id": { "type": "string", "format": "uuid" },
        "kind": { "enum": ["insert", "update", "link", "unlink"] },
        "target": { "$ref": "#/$defs/target" },
        "reason": { "type": "string", "minLength": 1, "maxLength": 2000 },
        "changes": { "type": "array", "minItems": 1, "maxItems": 50, "items": { "$ref": "#/$defs/change" } },
        "sources": { "type": "array", "items": { "$ref": "#/$defs/source_proposal" } },
        "depends_on": { "type": "array", "uniqueItems": true, "items": { "type": "string", "format": "uuid" } }
      }
    }
  }
}
```

Semantiske regler uden for grundschemaet:

- Operation-id'er er unikke, og dependencies skal danne en acyklisk graf.
- **Insert-targets:** `kind: insert` kræver `record_id: null` og en `local_ref` (`new:<navn>`), der er unik i batchen. Databasen reserverer det rigtige id ved et senere apply; id'er må aldrig opfindes i filen. Andre operationer i samme batch kan referere den nye række via `local_ref` i deres target (fx en source, der knyttes til et event oprettet i samme batch, eller en `link` til en ny relation). Update/link/unlink mod eksisterende rækker bruger `record_id` og må ikke have `local_ref`.
- **Preconditions:** `expected_before` evalueres altid mod baselinen (snapshottet). Derfor må samme (entitet, felt) højst ændres af én operation pr. batch — to operationer, der rører samme felt, er en valideringsfejl (`OPERATION_CONFLICT`), ikke en sekvens. Det holder dry-run deterministisk og gør stale-detektion entydig.
- **Helhedskilder:** `supports: []` betyder eksplicit, at kilden dækker hele entiteten og mappes til `sources.field_name = NULL`. Et ikke-tomt `supports`-array mappes til én `sources`-række pr. feltnavn. Feltnavne skal findes i felt-allowlisten for target-entiteten.
- **Slugændringer kræver redirect:** en `set`-ændring af `companies.slug` eller `investors.slug` skal have et `redirect_from`-felt på operationen (den gamle slug), og dry-run skal udskrive den `_redirects`-linje, der skal committes sammen med gentrykket. Gamle URL'er må aldrig dø tavst (jf. `docs/AI-WORKFLOW.md`).
- Tilladte felter og værdityper kommer fra en eksplicit allowlist pr. entitet, afledt af `validate-data.mjs`-reglerne; `aftale` er en genereret kolonne og må aldrig være et target-felt.
- Event-insert kræver mindst én source; `clear` skal have `value: null`; link/unlink må kun ramme relationstabellerne (`deal_investor`, `panel_membership`).
- **Entydig NULL-repræsentation (præciseret i 4A-implementeringen):** på update er `clear` den eneste måde at sætte et felt til NULL (`set` med `value: null` afvises — `SET_NULL_USE_CLEAR`); på insert er `set` med `value: null` den legitime startværdi, og `clear` afvises (`INSERT_CLEAR`).
- `applied` findes ikke som inbox-status i 1.0.0 — anvendthed dokumenteres af revisionsloggen, ikke af inboxen. En senere kontraktversion kan tilføje `applied` sammen med et obligatorisk `applied_revision`-felt, når et apply-trin overhovedet er godkendt.

## Revisionslog

Loggen er append-only på procesniveau. Den gemmer hashes og et struktureret changeset, ikke secrets eller ukontrollerede fulde databasedumps.

**Filformat (revideret):** loggen lagres som **NDJSON** — én entry pr. linje, valideret enkeltvis mod `schemas/revision-entry.schema.json`. Det gør append-only naturligt, gør prefix-verifikation triviel og undgår en fælles JSON-array-wrapper. Den efterfølgende indlejrede wrapper er historisk designskitse; den implementerede fil har ingen `log_id`/`entries`-indpakning. Rettelser bruger et nyt entry med `supersedes`; historik overskrives aldrig.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hulensdata.dk/schemas/revisions-log-1.0.0.json",
  "title": "Hulens Data revisionslog",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "log_id", "entries"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "log_id": { "type": "string", "format": "uuid" },
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["revision_id", "recorded_at", "actor", "inbox_id", "operation_ids", "result", "baseline_sha256", "after_sha256", "changes", "reason"],
        "properties": {
          "revision_id": { "type": "string", "format": "uuid" },
          "recorded_at": { "type": "string", "format": "date-time" },
          "actor": { "$ref": "#/$defs/actor" },
          "approved_by": { "oneOf": [{ "$ref": "#/$defs/actor" }, { "type": "null" }] },
          "inbox_id": { "type": "string", "format": "uuid" },
          "operation_ids": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "format": "uuid" } },
          "result": { "enum": ["planned", "applied", "rejected", "no_op", "rolled_back", "failed"] },
          "baseline_sha256": { "$ref": "#/$defs/sha256" },
          "after_sha256": { "oneOf": [{ "$ref": "#/$defs/sha256" }, { "type": "null" }] },
          "git_sha": { "type": ["string", "null"], "pattern": "^[0-9a-f]{40}$" },
          "backup_id": { "type": ["string", "null"], "format": "uuid" },
          "reason": { "type": "string", "minLength": 1, "maxLength": 2000 },
          "changes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["entity_type", "record_key", "field", "before_hash", "after_hash"],
              "properties": {
                "entity_type": { "type": "string", "minLength": 1, "maxLength": 50 },
                "record_key": { "type": "string", "minLength": 1, "maxLength": 120 },
                "field": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
                "before_hash": { "oneOf": [{ "$ref": "#/$defs/sha256" }, { "type": "null" }] },
                "after_hash": { "oneOf": [{ "$ref": "#/$defs/sha256" }, { "type": "null" }] }
              }
            }
          },
          "error_code": { "type": ["string", "null"], "pattern": "^[A-Z][A-Z0-9_]*$" }
        }
      }
    }
  },
  "$defs": {
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "actor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "id"],
      "properties": {
        "kind": { "enum": ["human", "agent", "system"] },
        "id": { "type": "string", "minLength": 1, "maxLength": 120 }
      }
    }
  }
}
```

Append-only kan ikke håndhæves af JSON Schema. Validatoren skal kræve, at en ny fil har den gamle log som eksakt byte-præfiks, at revision-id'er er unikke, og at `applied` har approver, after-hash og backup-id. En rollback er en ny entry; historik overskrives aldrig.

**Hvad loggen kan og ikke kan:** den dokumenterer det redaktionelle workflow (forslag, validering, godkendelse, planlagt/afvist) og kobler batch, git-SHA, backup-id og snapshot-hashes. Den kan ikke *bevise* databasehistorik — `updated_at` og en fremtidig read-back er databasens egen evidens. `published` skal ikke være et manuelt felt: publicering udledes af det efterfølgende gentryk (git-SHA + snapshottets `trykt`-dato), og et afstemningsværktøj kan advare, hvis ledgerens `after_sha256` ikke genfindes i et senere snapshot (ude-af-sync-detektion — advarsel, ikke blocker, så længe apply ikke findes).

## Coverage backlog

Backloggen er et deterministisk arbejdsprodukt af snapshot+regelsæt. Den må ikke blive en redigerbar kopi af company-status eller sources.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hulensdata.dk/schemas/coverage-backlog-1.0.0.json",
  "title": "Hulens Data coverage backlog",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "generated_at", "generator_version", "snapshot_sha256", "items"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "generated_at": { "type": "string", "format": "date-time" },
    "generator_version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    "snapshot_sha256": { "$ref": "#/$defs/sha256" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["item_id", "rule_id", "dimension", "entity", "observed_state", "priority", "reason"],
        "properties": {
          "item_id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9._:-]+$" },
          "rule_id": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]+$" },
          "dimension": { "enum": ["cvr", "category", "company_status", "source", "afterlife", "episode", "asked_amount", "deal_equity", "investor_profile", "identity_review"] },
          "entity": {
            "type": "object",
            "additionalProperties": false,
            "required": ["type", "id", "slug"],
            "properties": {
              "type": { "enum": ["company", "deal", "investor", "season"] },
              "id": { "type": "integer", "minimum": 1 },
              "slug": { "type": ["string", "null"], "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" }
            }
          },
          "observed_state": { "enum": ["unknown", "known", "not_applicable", "blocked", "ambiguous"] },
          "priority": { "enum": ["critical", "high", "medium", "low"] },
          "reason": { "type": "string", "minLength": 1, "maxLength": 1000 },
          "evidence_refs": { "type": "array", "uniqueItems": true, "items": { "type": "string", "maxLength": 200 } }
        }
      }
    }
  },
  "$defs": {
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
  }
}
```

`item_id` skal være deterministisk, fx `COMPANY_CVR_UNKNOWN:174` (regel + stabilt database-id, aldrig navn/slug — så overlever id'et navnerettelser). **Generatorens output indeholder ingen manuelle felter** (revideret: `workflow_status`, `blocked_by` og `resolved_by_revision` er fjernet fra det genererede schema). Manuel status bor i en separat overlay-fil (`coverage-overlay.json`) med `{ item_id, workflow_status ∈ open/in_review/resolved/dismissed, blocked_by, resolved_by_revision, decided_by, decided_at }`, og et deterministisk merge-værktøj kombinerer de to. Et item, der forsvinder fra generatoroutputtet, er dermed lukket af data — et item, der lukkes i overlayet uden dataændring, kræver en eksplicit `not_applicable`/`dismissed`-afgørelse med begrundelse. Backloggen blokerer aldrig deploy; kun `validate-data`-blockers gør.

## Backupmanifest

Manifestet beskriver én afsluttet eksport. `complete` må først sættes efter alle artefakter er skrevet, lukket, hashet, reparset og krydstjekket.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hulensdata.dk/schemas/backup-manifest-1.0.0.json",
  "title": "Hulens Data backup manifest",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "backup_id", "created_at", "status", "source", "tool", "consistency", "migration_head", "git_sha", "artifacts", "restore_order", "verification"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "backup_id": { "type": "string", "format": "uuid" },
    "created_at": { "type": "string", "format": "date-time" },
    "status": { "enum": ["in_progress", "complete", "failed"] },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["provider", "project_ref", "environment", "database_version", "read_role"],
      "properties": {
        "provider": { "const": "supabase" },
        "project_ref": { "type": "string", "pattern": "^[a-z0-9]{20}$" },
        "environment": { "enum": ["production", "branch", "isolated"] },
        "database_version": { "type": "string", "minLength": 1, "maxLength": 50 },
        "read_role": { "enum": ["anon", "authenticated", "service_role", "database_role"] }
      }
    },
    "tool": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "version"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 100 },
        "version": { "type": "string", "minLength": 1, "maxLength": 40 }
      }
    },
    "consistency": { "enum": ["sequential_per_table", "single_transaction", "unknown"] },
    "published_snapshot_sha256": { "oneOf": [{ "$ref": "#/$defs/sha256" }, { "type": "null" }] },
    "migration_head": { "type": "string", "pattern": "^[0-9]{14}_[a-z0-9_]+$" },
    "git_sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
    "artifacts": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["kind", "relative_path", "sha256", "bytes", "rows", "query"],
        "properties": {
          "kind": { "enum": ["table_json", "view_json", "schema_ddl", "migration_list", "policy_dump", "grant_dump", "publication_snapshot"] },
          "object_name": { "type": ["string", "null"], "pattern": "^[a-z_][a-z0-9_]*$" },
          "relative_path": { "type": "string", "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$" },
          "sha256": { "$ref": "#/$defs/sha256" },
          "bytes": { "type": "integer", "minimum": 1 },
          "rows": { "type": ["integer", "null"], "minimum": 0 },
          "query": { "type": ["string", "null"], "maxLength": 2000 },
          "content_range_total": { "type": ["integer", "null"], "minimum": 0 }
        }
      }
    },
    "restore_order": {
      "type": "array",
      "uniqueItems": true,
      "items": { "enum": ["seasons", "investors", "panel_memberships", "companies", "deals", "deal_investors", "company_events", "sources"] }
    },
    "verification": {
      "type": "object",
      "additionalProperties": false,
      "required": ["verified_at", "hashes_ok", "json_parse_ok", "row_counts_ok", "references_ok", "restore_rehearsed"],
      "properties": {
        "verified_at": { "type": "string", "format": "date-time" },
        "hashes_ok": { "type": "boolean" },
        "json_parse_ok": { "type": "boolean" },
        "row_counts_ok": { "type": "boolean" },
        "references_ok": { "type": "boolean" },
        "restore_rehearsed": { "type": "boolean" },
        "restore_rehearsed_at": { "type": ["string", "null"], "format": "date-time" },
        "notes": { "type": ["string", "null"], "maxLength": 2000 }
      }
    }
  },
  "$defs": {
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
  }
}
```

Et `complete` manifest med `backup_scope: data_export` kræver semantisk alle otte tabeller, viewet og migrationslisten. Kun `backup_scope: full_recovery_set` kræver derudover schema-DDL, policy- og grant-artefakter. `content_range_total` skal matche `rows`, når REST leverer total. Credentials, headers og fulde connection strings må aldrig skrives i `query` eller andre felter. Fase 4A bygger/verificerer kun allerede eksisterende filer og udfører ingen eksport eller atomisk publicering.

Revideret efter review: `environment` skelner produktionsbackup fra branch/isoleret miljø, `tool` + `version` identificerer eksportværktøjet, `consistency` er et eksplicit felt (den nuværende REST-eksport er `sequential_per_table` — ikke transaktionelt konsistent, og det skal manifestet sige ærligt), og `published_snapshot_sha256` kan valgfrit koble backuppen til det samtidigt publicerede `arkiv.json`. En anon-REST-eksport kan aldrig få `kind: schema_ddl`/`policy_dump`/`grant_dump`-artefakter — et manifest uden dem er en *dataeksport*, og verifikationsafsnittet må ikke kalde den en fuld databasebackup.

## Mapping til eksisterende produktionsmodel

| Workflowtype | Genbruger | Må ikke gøre |
|---|---|---|
| Inbox target | Eksisterende PK/slug og snapshot-hash | Oprette en parallel company/event/source-identitet |
| Inbox evidence | Samme confidence og source-kontrakt | Behandle aggregatorlead som automatisk bekræftet |
| Revision | `updated_at`, sources-noter, git-SHA og backup-id | Overskrive tidligere entries eller gemme secrets |
| Coverage | Snapshot og eksisterende NULL-semantik | Oversætte fravær af event/kilde til negativ historisk påstand |
| Backup | Eksisterende tabeller, view, migrationshead og restoreorden | Kalde en samling JSON-tabeller en fuld databasebackup uden DDL/policies/grants |
