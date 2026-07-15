# Fase 4 — foreslåede datakontrakter

> Dokumentationsforslag, 2026-07-16. JSON Schema-eksemplerne er ikke produktionskode, er ikke installeret og ændrer ikke Supabase. De bruger JSON Schema Draft 2020-12.

## Fælles konventioner

- `schema_version` starter på `1.0.0`; breaking changes kræver nyt major-nummer og eksplicit migration af artefakter.
- Timestamps er UTC RFC 3339 med `Z`; domænedatoer er `YYYY-MM-DD` og følger eksisterende `date_precision`.
- Alle ids er strenge i workflowlaget. Eksisterende database-id'er transporteres som positive heltal i et eksplicit targetfelt.
- SHA-256 skrives som 64 lowercase hextegn og beregnes over rå bytes, ikke reparset JSON.
- `additionalProperties: false` er standard. Udvidelser kræver schema-version, ikke tavse felter.
- NULL må kun bruges, hvor kontrakten siger det. `unknown`, `not_applicable`, `known` og `blocked` er separate tilstande; manglende data er aldrig automatisk `false`.
- Ingen kontrakt må indeholde API-nøgler, cookies, Authorization-headere, build-hook-URL'er eller andre secrets.
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
    "status": { "enum": ["new", "triaged", "in_review", "accepted", "rejected", "blocked", "applied"] },
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
        "record_id": { "type": "integer", "minimum": 1 },
        "secondary_id": { "type": ["integer", "null"], "minimum": 1 },
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
        "supports": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "minLength": 1, "maxLength": 80 } },
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

Semantiske regler uden for grundschemaet: operation-id'er er unikke; dependencies skal danne en acyklisk graf; `expected_before` skal matche baseline; target skal kunne opløses entydigt; tilladte felter og værdityper kommer fra en eksplicit allowlist; event-insert kræver mindst én source; `clear` skal have `value: null`; insert-id'er må ikke opfindes før databasen har reserveret dem; link/unlink må kun ramme relationstabeller. `applied` kræver revisions-id og read-back i en senere kontraktversion.

## Revisionslog

Loggen er append-only på procesniveau. Den gemmer hashes og et struktureret changeset, ikke secrets eller ukontrollerede fulde databasedumps.

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

Append-only kan ikke håndhæves af JSON Schema. Validatoren skal kræve, at en ny fil har den gamle log som eksakt prefix, at revision-id'er er unikke, og at `applied` har approver, after-hash og backup-id. En rollback er en ny entry; historik overskrives aldrig.

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
        "required": ["item_id", "rule_id", "dimension", "entity", "observed_state", "priority", "workflow_status", "reason"],
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
          "workflow_status": { "enum": ["open", "in_review", "resolved", "dismissed"] },
          "reason": { "type": "string", "minLength": 1, "maxLength": 1000 },
          "evidence_refs": { "type": "array", "uniqueItems": true, "items": { "type": "string", "maxLength": 200 } },
          "blocked_by": { "type": ["string", "null"], "maxLength": 500 },
          "resolved_by_revision": { "type": ["string", "null"], "format": "uuid" }
        }
      }
    }
  },
  "$defs": {
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
  }
}
```

`item_id` bør være deterministisk, fx `COMPANY_CVR_UNKNOWN:174`, så samme hul ikke duplikeres mellem builds. Manuelle statusfelter må ligge i et lille overlay knyttet til item-id og snapshot-hash; generatoroutputtet selv regenereres. Et bortfaldet item er ikke bevis for, at research er korrekt, før en revision eller en eksplicit `not_applicable`-afgørelse findes.

## Backupmanifest

Manifestet beskriver én afsluttet eksport. `complete` må først sættes efter alle artefakter er skrevet, lukket, hashet, reparset og krydstjekket.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hulensdata.dk/schemas/backup-manifest-1.0.0.json",
  "title": "Hulens Data backup manifest",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "backup_id", "created_at", "status", "source", "migration_head", "git_sha", "artifacts", "restore_order", "verification"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "backup_id": { "type": "string", "format": "uuid" },
    "created_at": { "type": "string", "format": "date-time" },
    "status": { "enum": ["in_progress", "complete", "failed"] },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["provider", "project_ref", "database_version", "read_role"],
      "properties": {
        "provider": { "const": "supabase" },
        "project_ref": { "type": "string", "pattern": "^[a-z]{20}$" },
        "database_version": { "type": "string", "minLength": 1, "maxLength": 50 },
        "read_role": { "enum": ["anon", "authenticated", "service_role", "database_role"] }
      }
    },
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

Et `complete` manifest skal semantisk kræve alle otte tabeller, viewet, migrationsliste og en schema-/policy-/grant-repræsentation. `content_range_total` skal matche `rows`, når REST leverer total. Manifest og artefakter skal først flyttes atomisk fra en tempmappe efter succes. Credentials, headers og fulde connection strings må aldrig skrives i `query` eller andre felter.

## Mapping til eksisterende produktionsmodel

| Workflowtype | Genbruger | Må ikke gøre |
|---|---|---|
| Inbox target | Eksisterende PK/slug og snapshot-hash | Oprette en parallel company/event/source-identitet |
| Inbox evidence | Samme confidence og source-kontrakt | Behandle aggregatorlead som automatisk bekræftet |
| Revision | `updated_at`, sources-noter, git-SHA og backup-id | Overskrive tidligere entries eller gemme secrets |
| Coverage | Snapshot og eksisterende NULL-semantik | Oversætte fravær af event/kilde til negativ historisk påstand |
| Backup | Eksisterende tabeller, view, migrationshead og restoreorden | Kalde en samling JSON-tabeller en fuld databasebackup uden DDL/policies/grants |
