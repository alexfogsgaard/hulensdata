#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createReport } from './lib/report.mjs';
import { sha256 } from './lib/schema-dump-review.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const report = createReport('Lokal baseline-replay');

const paths = {
  result: join(root, 'supabase/baseline/local-replay-result.json'),
  baseline: join(root, 'supabase/baseline/project-schema-baseline.draft.sql'),
  inventory: join(root, 'supabase/baseline/project-schema-baseline.draft.inventory.json'),
  review: join(root, 'supabase/schema-dump-review.json'),
  precondition: join(root, 'tools/sql/local-baseline-preconditions.sql'),
  acl: join(root, 'supabase/baseline/project-schema-acl.contract.draft.sql'),
  fixture: join(root, 'tools/sql/local-baseline-replay-fixture.sql'),
};

function read(path, code) {
  if (!existsSync(path)) {
    report.blocker(code, 'Påkrævet fil mangler', relative(root, path));
    return null;
  }
  return readFileSync(path, 'utf8');
}

function parse(text, code) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    report.blocker(code, error.message);
    return null;
  }
}

function allZero(value) {
  return Object.values(value || {}).every(item => Number(item) === 0);
}

function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const fullPath = join(path, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

const texts = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path, `LOCAL_REPLAY_${key.toUpperCase()}_MISSING`)]));
const result = parse(texts.result, 'LOCAL_REPLAY_RESULT_JSON');
const inventory = parse(texts.inventory, 'LOCAL_REPLAY_INVENTORY_JSON');
const review = parse(texts.review, 'LOCAL_REPLAY_REVIEW_JSON');

if (result && inventory && review && Object.values(texts).every(value => value != null)) {
  if (result.format_version !== 1 || result.status !== 'local_replay_passed_with_review_findings') {
    report.blocker('LOCAL_REPLAY_STATUS', 'Resultatet skal være version 1 og passed_with_review_findings');
  }
  if (result.source_commit !== 'd6cfebae23b13022cd5c5cd5cf4671a845acb3f0') {
    report.blocker('LOCAL_REPLAY_SOURCE', 'Forkert baseline-draft source-commit');
  }
  const provenance = result.provenance || {};
  if (provenance.production_connections !== 0 || provenance.remote_supabase_writes !== false || provenance.linked_project_state_used !== false) {
    report.blocker('LOCAL_REPLAY_ISOLATION', 'Resultatet må ikke indeholde productionforbindelse, remote write eller linked state');
  }
  if (provenance.credentials_required !== false || provenance.private_artifacts_committed !== false) {
    report.blocker('LOCAL_REPLAY_PRIVATE', 'Replay skal være credential-frit og uden private artefakter i Git');
  }
  if (provenance.local_clusters_created !== 2 || provenance.local_clusters_destroyed !== 2) {
    report.blocker('LOCAL_REPLAY_CLUSTER_COUNT', 'Præcis to lokale clusters skal være oprettet og destrueret');
  }
  if (!Array.isArray(provenance.forbidden_commands_run) || provenance.forbidden_commands_run.length !== 0) {
    report.blocker('LOCAL_REPLAY_FORBIDDEN_COMMAND', 'Forbidden-command-listen skal være tom');
  }

  for (const [name, version] of Object.entries(result.toolchain?.versions || {})) {
    if (!/PostgreSQL(?:\))? 17\.10/.test(version)) report.blocker('LOCAL_REPLAY_TOOLCHAIN', `${name} er ikke PostgreSQL 17.10`);
  }
  if (Object.keys(result.toolchain?.versions || {}).length !== 5 || result.toolchain?.major_version !== 17) {
    report.blocker('LOCAL_REPLAY_TOOLCHAIN', 'Fem låste PostgreSQL 17-værktøjer skal dokumenteres');
  }
  if (result.toolchain?.extension?.name !== 'moddatetime' || result.toolchain?.extension?.schema !== 'extensions') {
    report.blocker('LOCAL_REPLAY_EXTENSION', 'moddatetime-preconditionen er ikke dokumenteret korrekt');
  }

  const inputChecks = [
    ['baseline_sha256', texts.baseline],
    ['schema_review_sha256', texts.review],
    ['precondition_sha256', texts.precondition],
    ['acl_contract_sha256', texts.acl],
    ['synthetic_fixture_sha256', texts.fixture],
  ];
  for (const [field, text] of inputChecks) {
    if (result.inputs?.[field] !== sha256(text)) report.blocker('LOCAL_REPLAY_INPUT_HASH', `${field} matcher ikke`);
  }
  if (result.inputs?.baseline_sha256 !== inventory.draft?.sha256 || result.inputs?.baseline_modified !== false) {
    report.blocker('LOCAL_REPLAY_BASELINE_DRIFT', 'Baseline-SQL må ikke være ændret');
  }

  const replay = result.replay || {};
  if (replay.independent_empty_clusters !== 2 || replay.successful_replays !== 2 || replay.empty_before_replay !== true || replay.empty_after_baseline !== true) {
    report.blocker('LOCAL_REPLAY_REPLAY_COUNT', 'To tomme, succesfulde replayruns skal dokumenteres');
  }
  if (replay.deterministic_final_schema !== true || !/^[a-f0-9]{64}$/.test(replay.normalized_schema_sha256 || '')) {
    report.blocker('LOCAL_REPLAY_DETERMINISM', 'Deterministisk slut-schemahash mangler');
  }
  if (replay.schema_review_all_match !== true || replay.object_comparison?.all_match !== true) {
    report.blocker('LOCAL_REPLAY_SCHEMA_DIFF', 'Project-schemaet matcher ikke schema-dump-review');
  }
  for (const [key, values] of Object.entries(inventory.object_inventory || {})) {
    if (key === 'schemas') continue;
    const actual = replay.object_inventory?.[key] || [];
    if (JSON.stringify(values) !== JSON.stringify(actual)) report.blocker('LOCAL_REPLAY_OBJECT_INVENTORY', `${key} matcher ikke baselineinventory`);
  }
  const allowlist = replay.schema_precondition_allowlist || {};
  if (JSON.stringify(allowlist.reference_dump_schemas) !== JSON.stringify(review.object_inventory?.project_schema?.schemas || []) ||
      JSON.stringify(allowlist.local_dump_schemas) !== JSON.stringify(['public']) ||
      JSON.stringify(allowlist.allowed_local_only) !== JSON.stringify(['public']) ||
      (allowlist.unexpected || []).length !== 0) {
    report.blocker('LOCAL_REPLAY_SCHEMA_ALLOWLIST', 'Den pre-existing public-schemaforskel er ikke præcist allowlistet');
  }
  if (!allZero(replay.schema_only_data_signals)) report.blocker('LOCAL_REPLAY_DATA', 'Schema-only resultatet indeholder datasignaler');

  const security = result.security_tests || {};
  const expectedTables = inventory.object_inventory?.row_security || [];
  if (JSON.stringify(security.rls_enabled_tables) !== JSON.stringify(expectedTables)) report.blocker('LOCAL_REPLAY_RLS', 'RLS er ikke bevist på præcis otte tabeller');
  if (security.policies?.length !== 8) report.blocker('LOCAL_REPLAY_POLICIES', 'Præcis otte policies forventes');
  if (security.select_statements_attempted !== 18 || security.select_statements_succeeded !== 18 || security.anon_relations_with_visible_fixture !== 9) {
    report.blocker('LOCAL_REPLAY_SELECT', 'Positive SELECT-tests er ikke komplette');
  }
  if (security.authenticated_relations_with_visible_fixture !== 8 || security.authenticated_deals_visible_rows !== 0) {
    report.blocker('LOCAL_REPLAY_POLICY_ASYMMETRY', 'Den fangede authenticated/deals-asymmetri er ikke bevaret');
  }
  if (security.negative_writes_attempted !== 48 || security.negative_writes_denied !== 48 || security.unexpected_write_privileges !== 0 || security.unexpected_sequence_privileges !== 0) {
    report.blocker('LOCAL_REPLAY_WRITE_ACCESS', 'Alle 48 write-probes skal afvises uden write-/sequenceprivilegier');
  }
  if (security.expected_local_owners_only !== true || security.owner_inventory?.length !== 15 || !security.owner_inventory.every(item => item.owner === 'postgres')) {
    report.blocker('LOCAL_REPLAY_OWNERS', 'Lokalt owner-inventory afviger');
  }
  const beforeAcl = security.baseline_privilege_matrix || {};
  if (beforeAcl.tables?.length !== 18 || !beforeAcl.tables.every(item => !item.can_select && !item.can_insert && !item.can_update && !item.can_delete) ||
      beforeAcl.sequences?.length !== 10 || !beforeAcl.sequences.every(item => !item.can_use && !item.can_select && !item.can_update) ||
      beforeAcl.function?.public_execute !== true || beforeAcl.function?.anon_execute !== true || beforeAcl.function?.authenticated_execute !== true) {
    report.blocker('LOCAL_REPLAY_BASELINE_GRANTS', 'Baseline-only grants afviger fra den dokumenterede default-funktions-ACL');
  }
  const afterAcl = security.acl_contract_privilege_matrix || {};
  if (afterAcl.tables?.length !== 18 || !afterAcl.tables.every(item => item.can_select && !item.can_insert && !item.can_update && !item.can_delete) ||
      afterAcl.sequences?.length !== 10 || !afterAcl.sequences.every(item => !item.can_use && !item.can_select && !item.can_update) ||
      afterAcl.function?.public_execute !== false || afterAcl.function?.anon_execute !== false || afterAcl.function?.authenticated_execute !== false) {
    report.blocker('LOCAL_REPLAY_ACL_MATRIX', 'Den lokale ACL-matrix er ikke præcist least-privilege');
  }
  if (!security.fixture_contract?.generated_aftale || security.fixture_contract?.investor_status !== 'aktiv' ||
      !security.fixture_contract?.company_trigger || !security.fixture_contract?.investor_trigger || !security.fixture_contract?.event_trigger) {
    report.blocker('LOCAL_REPLAY_FIXTURE', 'Generated column, view eller moddatetime-trigger er ikke bevist');
  }
  const catalog = security.catalog_integrity || {};
  if (catalog.physical_table_columns !== 59 || catalog.constraints !== 26 || catalog.constraints_validated !== 26 ||
      catalog.standalone_indexes !== 7 || catalog.standalone_indexes_valid_ready !== 7 ||
      catalog.user_triggers !== 3 || catalog.enabled_user_triggers !== 3 || catalog.policies !== 8) {
    report.blocker('LOCAL_REPLAY_CATALOG', 'Kolonner, constraints, indeks, triggers eller policies er ikke katalogvalideret');
  }

  const functionReview = result.security_definer_review || {};
  if (functionReview.observed_before_acl?.security_definer !== true || functionReview.observed_before_acl?.owner !== 'postgres' ||
      functionReview.observed_before_acl?.public_execute !== true || functionReview.observed_before_acl?.anon_execute !== true ||
      functionReview.observed_before_acl?.authenticated_execute !== true) {
    report.blocker('LOCAL_REPLAY_FUNCTION_BEFORE_ACL', 'Default PUBLIC EXECUTE er ikke dokumenteret');
  }
  if (JSON.stringify(functionReview.observed_before_acl?.config) !== JSON.stringify(['search_path=pg_catalog']) || functionReview.no_arguments !== true) {
    report.blocker('LOCAL_REPLAY_FUNCTION_SCOPE', 'Function search_path/inputflade afviger');
  }
  if (functionReview.observed_after_acl?.public_execute !== false || functionReview.observed_after_acl?.anon_execute !== false ||
      functionReview.observed_after_acl?.authenticated_execute !== false || functionReview.recommendation !== 'remove_before_promotion') {
    report.blocker('LOCAL_REPLAY_FUNCTION_RECOMMENDATION', 'ACL-resultat eller fjern-anbefaling mangler');
  }
  if (functionReview.direct_call_before_acl?.attempted_as !== 'anon' || functionReview.direct_call_before_acl?.statement_succeeded !== false ||
      functionReview.direct_call_before_acl?.failure_class !== 'event_trigger_context_required' || functionReview.direct_call_before_acl?.write_performed !== false) {
    report.blocker('LOCAL_REPLAY_FUNCTION_PROBE', 'Den direkte SECURITY DEFINER-probe er ikke dokumenteret sikkert');
  }

  const acl = result.acl_contract || {};
  if (acl.status !== 'draft_applied_locally_only' || acl.production_applied !== false || acl.table_select_grants_per_role !== 9 ||
      acl.table_write_grants_per_role !== 0 || acl.sequence_grants_per_role !== 0 || acl.rls_function_execute_for_public_roles !== false) {
    report.blocker('LOCAL_REPLAY_ACL_RESULT', 'ACL-kontraktresultatet afviger');
  }
  if (!/GRANT SELECT ON TABLE[\s\S]+TO anon, authenticated;/m.test(texts.acl) ||
      /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|ALL)/i.test(texts.acl) ||
      !/REVOKE ALL ON FUNCTION public\.rls_auto_enable\(\) FROM PUBLIC, anon, authenticated;/i.test(texts.acl)) {
    report.blocker('LOCAL_REPLAY_ACL_SQL', 'ACL-draften er ikke read-only/least-privilege');
  }
  if (!/CREATE EXTENSION moddatetime WITH SCHEMA extensions;/i.test(texts.precondition) || !/CREATE ROLE anon NOLOGIN/i.test(texts.precondition) || !/CREATE ROLE authenticated NOLOGIN/i.test(texts.precondition)) {
    report.blocker('LOCAL_REPLAY_PRECONDITION_SQL', 'Den lokale Supabase-role/moddatetime-precondition er ikke reproducerbar');
  }

  const publicText = `${texts.result}\n${texts.acl}\n${texts.precondition}\n${texts.fixture}`;
  if (/\/Users\/|private-captures|\.pgpass|postgres(?:ql)?:\/\/|\.supabase\.(?:com|co)\b|sb_secret_/i.test(publicText)) {
    report.blocker('LOCAL_REPLAY_SECRET', 'Committede replayfiler indeholder privat path, credential eller remote forbindelse');
  }
}

const forbiddenArtifacts = walk(root).filter(path => /(?:^|\/)(?:PG_VERSION|postmaster\.pid|postgres\.log|private-manifest\.json|project-schema\.raw\.sql)$/.test(path));
for (const path of forbiddenArtifacts) report.blocker('LOCAL_REPLAY_ARTIFACT', 'Lokalt database-/råartefakt må ikke ligge i repository', relative(root, path));

report.finish();
