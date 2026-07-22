#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function arg(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value && required) throw new Error(`Manglende argument: ${name}`);
  return value;
}

function hash(algorithm, value) {
  return createHash(algorithm).update(value).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stripSqlLiterals(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function classify(sql) {
  const code = stripSqlLiterals(sql);
  const classes = [];
  if (/\b(?:create|alter|drop)\s+(?:table|index|trigger|sequence|extension|type|schema)|\badd\s+constraint\b/i.test(code)) classes.push('DDL');
  if (/\b(?:insert\s+into|update|delete\s+from|truncate)\b/i.test(code)) classes.push('DML');
  if (/\b(?:grant|revoke|alter\s+default\s+privileges)\b/i.test(code)) classes.push('permissions');
  if (/\b(?:create|alter|drop)\s+policy\b|\b(?:enable|disable|force|no\s+force)\s+row\s+level\s+security\b/i.test(code)) classes.push('policy');
  if (/\b(?:create(?:\s+or\s+replace)?|alter|drop)\s+(?:function|procedure|view|materialized\s+view)\b/i.test(code)) classes.push('function/view');
  if (classes.length === 0) classes.push('other');
  return classes;
}

function scan(sql) {
  const code = stripSqlLiterals(sql);
  const dml = /\b(?:insert\s+into|update|delete\s+from|truncate)\b/i.test(code);
  const publicPersonNames = dml && /\b(?:investors|canonical_name)\b/i.test(code);
  const destructive = /\b(?:drop\s+(?:table|column|constraint|view|function|index)|delete\s+from|truncate)\b/i.test(code);
  const credentialSignals = {
    jwt: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(sql),
    secret_key: /\bsb_secret_[A-Za-z0-9_-]+\b|SUPABASE_SERVICE_ROLE_KEY\s*=/i.test(sql),
    private_key: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(sql),
    credential_uri: /postgres(?:ql)?:\/\/[^:\s'\"]+:[^@\s'\"]+@/i.test(sql),
    password_literal: /\bpassword\s*(?:=|to)\s*'(?:''|[^'])+'/i.test(sql),
  };
  const personalDataSignals = {
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(sql),
    public_person_names: publicPersonNames,
    cpr_candidate: /(?:^|\D)(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[- ]?\d{4}(?:\D|$)/.test(sql),
  };
  const environmentSignals = {
    supabase_roles: /\b(?:anon|authenticated|service_role|supabase_admin|postgres)\b/i.test(code),
    project_ref: /\b[a-z]{20}\b/.test(sql),
    urls: /https?:\/\//i.test(sql),
    extensions: /\b(?:create|drop)\s+extension\b/i.test(code),
  };
  return {
    credential_signals: credentialSignals,
    personal_data_signals: personalDataSignals,
    environment_signals: environmentSignals,
    contains_dml: dml,
    contains_destructive_sql: destructive,
    contains_dynamic_sql: /\bexecute\s+(?:format\s*\(|')/i.test(sql),
    contains_id_referencing_dml: dml && /\b(?:id|company_id|deal_id|investor_id)\b/i.test(code),
  };
}

function anyTrue(object) {
  return Object.values(object).some(Boolean);
}

const migrationsPath = resolve(arg('--migrations'));
const schemaPath = resolve(arg('--schema'));
const inventoryPath = resolve(arg('--inventory'));
const migrationQueryPath = resolve(arg('--migration-query'));
const schemaQueryPath = resolve(arg('--schema-query'));
const outputPath = resolve(arg('--output'));
const privateManifestPath = resolve(arg('--private-manifest'));

const rawText = readFileSync(migrationsPath, 'utf8');
const schemaText = readFileSync(schemaPath, 'utf8');
const raw = JSON.parse(rawText);
const schema = JSON.parse(schemaText);
const inventory = readJson(inventoryPath);
const expected = new Map(inventory.migrations.map(item => [item.version, item]));
const migrations = [];

for (const migration of raw.migrations) {
  const statementText = migration.statements.join('\n');
  const registered = expected.get(migration.version);
  if (!registered) throw new Error(`Ukendt capture-version: ${migration.version}`);
  if (registered.name !== migration.name) throw new Error(`Navnemismatch: ${migration.version}`);
  const capturedMd5 = hash('md5', statementText);
  const signals = scan(statementText);
  const classifications = classify(statementText);
  const reasons = ['baseline_sql_not_authorized_in_this_phase'];
  if (signals.contains_dml) reasons.push('contains_historical_data_mutation');
  if (signals.contains_destructive_sql) reasons.push('contains_destructive_sql');
  if (signals.contains_dynamic_sql) reasons.push('contains_dynamic_sql');
  if (anyTrue(signals.personal_data_signals)) reasons.push('contains_personal_or_public_person_data');
  if (anyTrue(signals.credential_signals)) reasons.push('contains_possible_credential');
  if (anyTrue(signals.environment_signals)) reasons.push('contains_environment_specific_reference');
  migrations.push({
    version: migration.version,
    name: migration.name,
    statement_count: migration.statements.length,
    byte_length: Buffer.byteLength(statementText),
    registered_md5: registered.remote_statements_md5,
    captured_md5: capturedMd5,
    fingerprint_match: capturedMd5 === registered.remote_statements_md5,
    classifications,
    safety_scan: signals,
    commit_status: 'hold_raw_private',
    replay_status: signals.contains_dml || signals.contains_destructive_sql || signals.contains_dynamic_sql
      ? 'unsafe_unmodified'
      : 'blocked_until_dependency_review',
    review_reasons: reasons,
  });
}

if (migrations.length !== expected.size) throw new Error('Capture og inventar har forskelligt antal migrationer');
const allFingerprintsMatch = migrations.every(item => item.fingerprint_match);
const schemaScan = scan(schemaText);
const rawStats = statSync(migrationsPath);
const schemaStats = statSync(schemaPath);
const migrationQuery = readFileSync(migrationQueryPath, 'utf8');
const schemaQuery = readFileSync(schemaQueryPath, 'utf8');
const relationNames = schema.relations.map(item => item.name).sort();

const metadata = {
  format_version: 1,
  captured_at: raw.captured_at,
  project_ref: raw.project_ref,
  base_commit: 'a576c70e0c9426fecf61237849602a5d939a396b',
  provenance: {
    method: 'Supabase MCP execute_sql with committed SELECT-only capture queries',
    migration_query: 'tools/sql/capture-migrations-readonly.sql',
    migration_query_sha256: hash('sha256', migrationQuery),
    schema_query: 'tools/sql/capture-project-schema-readonly.sql',
    schema_query_sha256: hash('sha256', schemaQuery),
    raw_files_committed: false,
    database_writes_performed: false,
    schema_capture_kind: 'project-schema catalog snapshot; not an official pg_dump archive',
  },
  fingerprint_summary: {
    expected: expected.size,
    captured: migrations.length,
    matching: migrations.filter(item => item.fingerprint_match).length,
    all_match: allFingerprintsMatch,
  },
  classification_summary: Object.fromEntries(
    ['DDL', 'DML', 'permissions', 'policy', 'function/view', 'other'].map(name => [
      name,
      migrations.filter(item => item.classifications.includes(name)).length,
    ])
  ),
  security_summary: {
    statements_with_possible_credentials: migrations.filter(item => anyTrue(item.safety_scan.credential_signals)).length,
    statements_with_personal_or_public_person_data: migrations.filter(item => anyTrue(item.safety_scan.personal_data_signals)).length,
    statements_with_environment_references: migrations.filter(item => anyTrue(item.safety_scan.environment_signals)).length,
    statements_with_dml: migrations.filter(item => item.safety_scan.contains_dml).length,
    statements_with_destructive_sql: migrations.filter(item => item.safety_scan.contains_destructive_sql).length,
    statements_with_dynamic_sql: migrations.filter(item => item.safety_scan.contains_dynamic_sql).length,
    schema_possible_credentials: anyTrue(schemaScan.credential_signals),
    schema_personal_data: schemaScan.personal_data_signals.email || schemaScan.personal_data_signals.cpr_candidate,
    schema_contains_table_row_data: false,
    schema_environment_references: anyTrue(schemaScan.environment_signals),
  },
  capture_metadata_summary: {
    migrations_with_created_by: raw.migrations.filter(item => item.created_by != null).length,
    migrations_with_idempotency_key: raw.migrations.filter(item => item.idempotency_key != null).length,
    migrations_with_rollback_statements: raw.migrations.filter(item => Array.isArray(item.rollback) && item.rollback.length > 0).length,
  },
  schema_summary: {
    captured_at: schema.captured_at,
    server_version: schema.server.version,
    relation_names: relationNames,
    relation_count: schema.relations.length,
    column_count: schema.columns.length,
    constraint_count: schema.constraints.length,
    index_count: schema.indexes.length,
    sequence_count: schema.sequences.length,
    view_count: schema.views.length,
    function_count: schema.functions.length,
    trigger_count: schema.triggers.length,
    policy_count: schema.policies.length,
    relation_privilege_count: schema.relation_privileges.length,
    default_acl_count: schema.default_acl.length,
    extension_count: schema.extensions.length,
    event_trigger_count: schema.event_triggers.length,
    publication_count: schema.publications.length,
  },
  chain_assessment: {
    creates_base_deals_table: raw.migrations.some(item => /\bcreate\s+table\s+(?:public\.)?deals\b/i.test(stripSqlLiterals(item.statements.join('\n')))),
    references_deals_table: raw.migrations.some(item => /\bdeals\b/i.test(stripSqlLiterals(item.statements.join('\n')))),
    empty_database_replay_claim: false,
    reason: 'The captured history references the pre-existing deals table but does not create its base schema.',
  },
  migrations,
};

if (!allFingerprintsMatch) throw new Error('Mindst ét migrationsfingeraftryk matcher ikke inventaret');

const privateManifest = {
  format_version: 1,
  captured_at: raw.captured_at,
  project_ref: raw.project_ref,
  files: [
    {
      name: basename(migrationsPath),
      bytes: rawStats.size,
      sha256: hash('sha256', rawText),
      mode_private: (rawStats.mode & 0o077) === 0,
    },
    {
      name: basename(schemaPath),
      bytes: schemaStats.size,
      sha256: hash('sha256', schemaText),
      mode_private: (schemaStats.mode & 0o077) === 0,
    },
  ],
  fingerprint_summary: metadata.fingerprint_summary,
  warning: 'Private raw capture. Do not commit or replay.',
};

writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
writeFileSync(privateManifestPath, `${JSON.stringify(privateManifest, null, 2)}\n`, { mode: 0o600 });
console.log(`Baselinecapture analyseret: ${migrations.length} migrationer · ${metadata.fingerprint_summary.matching} fingerprints matcher · rå SQL ikke kopieret til output`);
