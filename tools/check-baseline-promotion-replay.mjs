#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createReport } from './lib/report.mjs';
import { sha256 } from './lib/schema-dump-review.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const report = createReport('Database-baseline-promotion-replay');
const files = {
  result: 'supabase/baseline/promotion-candidate-local-replay-result.json',
  candidate: 'supabase/baseline/project-schema-baseline.promotion-candidate.sql',
  inventory: 'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json',
  draft: 'supabase/baseline/project-schema-baseline.draft.sql',
  review: 'supabase/schema-dump-review.json',
  precondition: 'tools/sql/local-baseline-preconditions.sql',
  fixture: 'tools/sql/local-baseline-replay-fixture.sql',
};

function read(relativePath, code) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    report.blocker(code, 'Påkrævet fil mangler', relativePath);
    return null;
  }
  return readFileSync(path, 'utf8');
}

function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

const texts = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, read(path, `PROMOTION_REPLAY_${key.toUpperCase()}_MISSING`)]));
if (Object.values(texts).every(value => value != null)) {
  let result;
  let inventory;
  try {
    result = JSON.parse(texts.result);
    inventory = JSON.parse(texts.inventory);
  } catch (error) {
    report.blocker('PROMOTION_REPLAY_JSON', error.message);
  }
  if (result && inventory) {
    if (result.status !== 'promotion_candidate_local_replay_passed_not_applied' || result.provenance?.production_applied !== false) {
      report.blocker('PROMOTION_REPLAY_STATUS', 'Replaystatus skal være passed lokalt og ikke anvendt på production');
    }
    if (result.provenance?.production_connections !== 0 || result.provenance?.remote_supabase_writes !== false ||
        result.provenance?.linked_project_state_used !== false || result.provenance?.credentials_required !== false ||
        result.provenance?.migration_history_changed !== false || result.provenance?.forbidden_commands_run?.length !== 0) {
      report.blocker('PROMOTION_REPLAY_ISOLATION', 'Replayresultatet bryder remote-/write-stopgrænsen');
    }
    if (result.provenance?.local_clusters_created !== 2 || result.provenance?.local_clusters_destroyed !== 2 ||
        result.replay?.independent_empty_clusters !== 2 || result.replay?.successful_replays !== 2 ||
        result.replay?.empty_before_replay !== true || result.replay?.empty_after_candidate !== true) {
      report.blocker('PROMOTION_REPLAY_CLUSTERS', 'To tomme, uafhængige og destruerede clusters er ikke bevist');
    }
    if (result.toolchain?.major_version !== 17 || !Object.values(result.toolchain?.versions || {}).every(value => /17\.10/.test(value))) {
      report.blocker('PROMOTION_REPLAY_TOOLCHAIN', 'Replay skal bruge PostgreSQL 17.10 for alle tools');
    }
    if (result.inputs?.candidate_sha256 !== sha256(texts.candidate) || result.inputs?.candidate_inventory_sha256 !== sha256(texts.inventory) ||
        result.inputs?.source_draft_sha256 !== sha256(texts.draft) || result.inputs?.schema_review_sha256 !== sha256(texts.review) ||
        result.inputs?.precondition_sha256 !== sha256(texts.precondition) || result.inputs?.synthetic_fixture_sha256 !== sha256(texts.fixture)) {
      report.blocker('PROMOTION_REPLAY_INPUT_HASH', 'Replayinput matcher ikke committede filer');
    }
    const hashes = result.replay?.run_schema_sha256 || [];
    if (hashes.length !== 2 || hashes[0] !== hashes[1] || hashes[0] !== result.replay?.normalized_schema_sha256 || result.replay?.deterministic_final_schema !== true) {
      report.blocker('PROMOTION_REPLAY_DETERMINISM', 'De to schemahashes er ikke identiske');
    }
    if (result.replay?.promotion_inventory_all_match !== true || result.replay?.object_comparison?.all_match !== true ||
        JSON.stringify(result.replay?.expected_difference_from_production_capture) !== JSON.stringify({ functions_removed: ['rls_auto_enable'], other_object_differences: [] })) {
      report.blocker('PROMOTION_REPLAY_OBJECT_DIFF', 'Promotion-inventory eller forventet productiondiff afviger');
    }
    for (const key of ['tables', 'columns', 'sequences', 'views', 'functions', 'triggers', 'indexes', 'constraints', 'policies', 'row_security']) {
      if (JSON.stringify(result.replay?.object_inventory?.[key] || []) !== JSON.stringify(inventory.object_inventory?.[key] || [])) {
        report.blocker('PROMOTION_REPLAY_OBJECT_DIFF', `${key} matcher ikke candidate-inventory`);
      }
    }
    if (Object.values(result.replay?.schema_only_data_signals || {}).some(value => value !== 0) ||
        Object.values(result.replay?.schema_only_credential_signals || {}).some(value => value !== 0) || result.replay?.schema_only_owner_statements !== 0) {
      report.blocker('PROMOTION_REPLAY_SAFETY_SCAN', 'Schema-only replaydump har data-, credential- eller ownersignal');
    }
    const security = result.security_tests || {};
    if (security.rls_enabled_tables?.length !== 8 || security.policies?.length !== 8) report.blocker('PROMOTION_REPLAY_RLS', '8/8 RLS og policies er ikke bevist');
    if (security.project_functions?.length !== 0 || security.security_definer_functions !== 0) report.blocker('PROMOTION_REPLAY_FUNCTIONS', 'Projectfunktion eller SECURITY DEFINER findes stadig');
    if (Object.values(security.default_function_privilege_probe || {}).some(value => value !== false)) {
      report.blocker('PROMOTION_REPLAY_PUBLIC_EXECUTE', 'Default PUBLIC/anon/authenticated EXECUTE er ikke fjernet');
    }
    if (security.select_statements_attempted !== 18 || security.select_statements_succeeded !== 18 || security.anon_relations_with_visible_fixture !== 9 ||
        security.authenticated_relations_with_visible_fixture !== 8 || security.authenticated_deals_visible_rows !== 0) {
      report.blocker('PROMOTION_REPLAY_SELECTS', 'Positiv SELECT-/deals-policykontrakt afviger');
    }
    if (security.negative_writes_attempted !== 48 || security.negative_writes_denied !== 48 || security.unexpected_table_privileges !== 0 ||
        security.unexpected_sequence_privileges !== 0 || security.unexpected_schema_privileges !== 0) {
      report.blocker('PROMOTION_REPLAY_PRIVILEGES', 'Write- eller ACL-kontrakten afviger');
    }
    if (result.acl_contract?.production_applied !== false || result.acl_contract?.project_function_count !== 0 ||
        result.acl_contract?.public_execute_on_future_project_functions !== false || result.acl_contract?.table_write_grants_per_role !== 0 ||
        result.acl_contract?.sequence_grants_per_role !== 0) {
      report.blocker('PROMOTION_REPLAY_ACL', 'Integreret ACL-status eller minimumsrettigheder afviger');
    }
    if (result.deals_policy_review?.status !== 'open_product_decision_current_behavior_retained' || result.deals_policy_review?.authenticated_fixture_rows !== 0) {
      report.blocker('PROMOTION_REPLAY_DEALS', 'Deals-policyen er ikke bevaret som åben beslutning');
    }
    if (!Array.isArray(result.blockers_before_promotion) || result.blockers_before_promotion.length < 4) {
      report.blocker('PROMOTION_REPLAY_BLOCKERS', 'Resterende promotionblockers mangler');
    }
    if (/\/Users\/|private-captures|\.pgpass|postgres(?:ql)?:\/\/|\.supabase\.(?:com|co)\b|sb_secret_/i.test(texts.result)) {
      report.blocker('PROMOTION_REPLAY_PRIVATE', 'Resultat indeholder privat path, credential eller remote forbindelse');
    }
  }
}

for (const path of walk(root).filter(path => /(?:^|\/)(?:PG_VERSION|postmaster\.pid|postgres\.log|private-manifest\.json|project-schema(?:-after-acl)?\.raw\.sql)$/.test(path))) {
  report.blocker('PROMOTION_REPLAY_ARTIFACT', 'Privat cluster-, log- eller dumpfil må ikke ligge i repository', relative(root, path));
}

report.finish();
