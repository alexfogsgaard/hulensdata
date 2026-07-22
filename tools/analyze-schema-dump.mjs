#!/usr/bin/env node
import { basename, resolve } from 'node:path';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import {
  anyPositive,
  compareDumpToCatalog,
  parsePgDump,
  sha256,
} from './lib/schema-dump-review.mjs';

const PROJECT_REF = 'upaxzfytumsijnbhjihd';
const BASE_COMMIT = 'bfd621886dd78cf7744d2e3c9db27843b693f14f';

function arg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`Manglende argument: ${name}`);
  return resolve(value);
}

function isPrivate(stat) {
  return (stat.mode & 0o077) === 0;
}

const dumpPath = arg('--dump');
const logPath = arg('--log');
const catalogPath = arg('--catalog');
const outputPath = arg('--output');
const dumpText = readFileSync(dumpPath, 'utf8');
const logText = readFileSync(logPath, 'utf8');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const dumpStat = statSync(dumpPath);
const logStat = statSync(logPath);
const parsed = parsePgDump(dumpText, { projectRef: PROJECT_REF });
const comparison = compareDumpToCatalog(parsed, catalog);
const scan = parsed.safety_scan;
const logFailures = (logText.match(/\b(?:error|fatal|failed)\b/gi) || []).length;
const logWarnings = (logText.match(/\bwarning\b/gi) || []).length;

const summary = {
  format_version: 1,
  captured_at: dumpStat.mtime.toISOString(),
  project_ref: PROJECT_REF,
  base_commit: BASE_COMMIT,
  provenance: {
    method: 'direct PostgreSQL pg_dump 17.10 over the Supabase session pooler',
    supabase_cli_used: false,
    cli_fallback_reason: 'Supabase CLI was not installed; direct pg_dump allowed password isolation through PGPASSFILE without putting credentials in process arguments',
    database_operation_count: 1,
    database_operations: ['pg_dump --schema-only'],
    remote_state_changes: false,
    database_writes_performed: false,
    migrations_commands_performed: false,
    replay_performed: false,
    connection: {
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user_pattern: `postgres.${PROJECT_REF}`,
      sslmode: 'verify-full',
      password_transport: 'PGPASSFILE outside repository; value never logged',
      default_transaction_read_only: true,
    },
    dump_flags: ['--schema-only', '--no-owner', '--no-privileges', '--lock-wait-timeout=5s'],
    raw_files_committed: false,
    private_paths_committed: false,
  },
  private_artifacts: {
    dump: {
      name: basename(dumpPath),
      bytes: dumpStat.size,
      lines: dumpText.split('\n').length - 1,
      sha256: sha256(dumpText),
      mode_private: isPrivate(dumpStat),
    },
    log: {
      name: basename(logPath),
      bytes: logStat.size,
      lines: logText.split('\n').length - 1,
      sha256: sha256(logText),
      mode_private: isPrivate(logStat),
      warning_count: logWarnings,
      failure_count: logFailures,
    },
  },
  versions: {
    server: parsed.server_version,
    pg_dump: parsed.pg_dump_version,
  },
  safety_scan: scan,
  safety_summary: {
    contains_table_rows: anyPositive(scan.data_signals),
    contains_custom_role_ddl: scan.role_and_acl_signals.create_role > 0 || scan.role_and_acl_signals.alter_role > 0,
    contains_executable_owner_or_acl_statements: [
      scan.role_and_acl_signals.owner_statements,
      scan.role_and_acl_signals.grant_statements,
      scan.role_and_acl_signals.revoke_statements,
    ].some(value => value > 0),
    contains_possible_credentials: anyPositive(scan.credential_signals),
    contains_email_or_cpr_candidates: anyPositive(scan.personal_data_signals),
    raw_dump_safe_to_commit: false,
    reason: 'The raw dump contains platform-managed and environment-specific schema metadata and is held private even though automated credential and row-data scans are clear.',
  },
  object_inventory: {
    header_count: parsed.header_count,
    by_type: parsed.by_type,
    by_schema: parsed.by_schema,
    project_schema: parsed.public_objects,
    database_wide: parsed.database_wide_objects,
    classification: {
      project_specific: ['public schema objects', 'public.rls_auto_enable()', 'ensure_rls event trigger'],
      supabase_managed_schemas: ['auth', 'extensions', 'graphql_public', 'pgbouncer', 'realtime', 'storage', 'supabase_migrations'],
      database_wide_review_required: ['extensions', 'event triggers', 'publication', 'owners and ACLs from catalog capture'],
    },
  },
  catalog_comparison: comparison,
  portability: {
    platform_schemas_must_not_be_copied_to_project_baseline: true,
    owner_annotations_present_in_comments: scan.environment_signals.owner_annotations > 0,
    executable_owner_statements_omitted: scan.role_and_acl_signals.owner_statements === 0,
    executable_grants_omitted: scan.role_and_acl_signals.grant_statements === 0 && scan.role_and_acl_signals.revoke_statements === 0,
    builtin_extension_exception: 'plpgsql is present in the catalog capture but intentionally not emitted as a CREATE EXTENSION object by pg_dump',
    required_project_extension_candidate: 'moddatetime',
    security_definer_and_event_trigger_review_required: true,
  },
  baseline_gate: {
    status: 'ready_for_sanitized_baseline_draft_in_separate_phase',
    baseline_sql_committed: false,
    replay_authorized: false,
    remote_history_alignment_authorized: false,
    next_gate: 'Manually derive project-only SQL, review function/policy/ACL portability, then replay only in an unlinked isolated PostgreSQL 17 environment.',
  },
};

if (!isPrivate(dumpStat) || !isPrivate(logStat)) throw new Error('Private artefakter skal have mode 600 eller strammere');
if (logFailures > 0 || logWarnings > 0) throw new Error('pg_dump-loggen indeholder warning/error/failure');
if (summary.safety_summary.contains_table_rows) throw new Error('Dumpet indeholder tegn på tabelrækker');
if (summary.safety_summary.contains_custom_role_ddl) throw new Error('Dumpet indeholder custom role DDL');
if (summary.safety_summary.contains_executable_owner_or_acl_statements) throw new Error('Dumpet indeholder owner/ACL-statements');
if (summary.safety_summary.contains_possible_credentials) throw new Error('Dumpet indeholder muligt credential');
if (summary.safety_summary.contains_email_or_cpr_candidates) throw new Error('Dumpet indeholder mulig persondata');
if (!comparison.all_project_objects_match || !comparison.extensions_match_with_documented_builtin_exception) {
  throw new Error('Dump og katalogcapture matcher ikke objekt-for-objekt');
}

writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Schema-dump analyseret: ${parsed.header_count} objektheadere · public-objekter matcher katalogcapturen · ingen data eller credentials fundet`);
