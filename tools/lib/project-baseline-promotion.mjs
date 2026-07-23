import { sha256 } from './schema-dump-review.mjs';
import { parseBaselineObjects, scanBaseline } from './project-baseline-draft.mjs';

export const PROMOTION_PHASES = [
  ['01_tables_and_sequences', 'Tables and sequence/default wiring'],
  ['02_primary_and_unique_constraints', 'Primary-key and unique constraints'],
  ['03_foreign_keys', 'Foreign-key constraints'],
  ['04_indexes', 'Standalone indexes'],
  ['05_view', 'Security-invoker view'],
  ['06_triggers', 'Updated-at triggers'],
  ['07_row_security', 'RLS enablement'],
  ['08_policies', 'Read policies'],
  ['09_acl_contract', 'Project-only least-privilege ACL contract'],
];

export const PROJECT_TABLES = [
  'companies',
  'company_events',
  'deal_investors',
  'deals',
  'investors',
  'panel_memberships',
  'seasons',
  'sources',
];

export const PROJECT_RELATIONS = [...PROJECT_TABLES, 'investor_status'];
export const PROJECT_SEQUENCES = [
  'companies_id_seq',
  'company_events_id_seq',
  'deals_id_seq',
  'investors_id_seq',
  'sources_id_seq',
];

function objectList(names) {
  return names.map(name => `  public.${name}`).join(',\n');
}

export const PROMOTION_ACL_SQL = `-- object: ACL public schema
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- object: ACL project tables and view
REVOKE ALL ON TABLE
${objectList(PROJECT_RELATIONS)}
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
${objectList(PROJECT_RELATIONS)}
TO anon, authenticated;

-- object: ACL project sequences
REVOKE ALL ON SEQUENCE
${objectList(PROJECT_SEQUENCES)}
FROM PUBLIC, anon, authenticated;

-- object: ACL default project objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`;

function header(draftText, draftInventoryText) {
  return `-- =============================================================================
-- HULENSDATA PROJECT SCHEMA BASELINE — PROMOTION CANDIDATE / NOT APPLIED
-- =============================================================================
-- Deterministically derived from the locally replayed project-only draft.
-- Source draft: supabase/baseline/project-schema-baseline.draft.sql
-- Source draft SHA-256: ${sha256(draftText)}
-- Source inventory SHA-256: ${sha256(draftInventoryText)}
-- Source replay gate commit: bd15a8a24403599271908efe16245807b6afed99
--
-- Included: project tables, sequences/default wiring, view, triggers, indexes,
-- constraints, explicit RLS/policies, and the project-only ACL contract.
-- Excluded: the obsolete SECURITY DEFINER RLS helper, event triggers, table rows,
-- historical DML, owners, role creation, credentials, platform-managed objects,
-- extension DDL, migration history, and connection/environment configuration.
--
-- External preconditions intentionally NOT created here:
--   * an existing public schema;
--   * PostgreSQL 17-compatible runtime;
--   * existing Supabase runtime roles anon and authenticated;
--   * extensions.moddatetime(text) for the three updated_at triggers.
--
-- POLICY STOP: the captured deals SELECT policy remains TO anon. Repository,
-- migration-history, and project documentation prove the current behavior but
-- do not prove that excluding authenticated was an intentional product choice.
-- The asymmetry is retained pending an explicit decision; it is not normalized.
--
-- STOP BOUNDARY: this candidate has only been replayed in unlinked local
-- clusters. It is not a migration, has not been applied to production, and is
-- not authorized for db push, migration repair, remote replay, or migration-
-- history alignment. The source draft remains immutable historical evidence.
-- =============================================================================`;
}

export function buildPromotionCandidate(draftText, draftInventoryText) {
  const inventory = JSON.parse(draftInventoryText);
  if (inventory.draft?.sha256 !== sha256(draftText)) throw new Error('Drafthash matcher ikke draftinventory');
  const start = draftText.indexOf('-- phase: 02_tables_and_sequences');
  if (start < 0) throw new Error('Draften mangler tables/sequences-fasen');
  const schemaBody = draftText.slice(start).trim().replace(
    /-- phase: 0([2-9])_([a-z_]+)/g,
    (_, number, suffix) => `-- phase: 0${Number(number) - 1}_${suffix}`,
  );
  const candidate = `${header(draftText, draftInventoryText)}\n\n${schemaBody}\n\n-- phase: 09_acl_contract\n-- Project-only least-privilege ACL contract\n\n${PROMOTION_ACL_SQL}\n`;
  if (/CREATE\s+FUNCTION|\bSECURITY\s+DEFINER\b(?!\s+RLS helper)/i.test(candidate)) {
    throw new Error('Promotion candidate må ikke bevare definerfunktionen');
  }
  return candidate;
}

function compareSet(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter(value => !actualSet.has(value));
  const extra = actual.filter(value => !expectedSet.has(value));
  return {
    expected_count: expected.length,
    actual_count: actual.length,
    missing,
    extra,
    match: missing.length === 0 && extra.length === 0,
  };
}

export function expectedPromotionObjects(review) {
  const source = review.object_inventory?.project_schema;
  if (!source) throw new Error('Schema-review mangler project_schema inventory');
  return {
    ...source,
    functions: (source.functions || []).filter(name => name !== 'rls_auto_enable'),
  };
}

export function compareToPromotionInventory(objects, review) {
  const expected = expectedPromotionObjects(review);
  const comparisons = {};
  for (const key of ['tables', 'columns', 'sequences', 'views', 'functions', 'triggers', 'indexes', 'constraints', 'policies', 'row_security']) {
    comparisons[key] = compareSet(expected[key] || [], objects[key] || []);
  }
  return { comparisons, all_match: Object.values(comparisons).every(item => item.match) };
}

export function promotionInventory(candidate, draftText, draftInventoryText, reviewText) {
  const objects = parseBaselineObjects(candidate);
  const comparison = compareToPromotionInventory(objects, JSON.parse(reviewText));
  const scan = scanBaseline(candidate);
  return {
    format_version: 1,
    status: 'promotion_candidate_locally_replayed_not_applied',
    source_gate_commit: 'bd15a8a24403599271908efe16245807b6afed99',
    provenance: {
      method: 'deterministic transformation of the immutable replayed draft; function removed; ACL integrated',
      source_draft_file: 'supabase/baseline/project-schema-baseline.draft.sql',
      source_draft_sha256: sha256(draftText),
      source_draft_inventory_sha256: sha256(draftInventoryText),
      schema_review_sha256: sha256(reviewText),
      database_connections_during_generation: 0,
      production_connections: 0,
      remote_writes: false,
      production_applied: false,
      migration_history_changed: false,
    },
    candidate: {
      file: 'supabase/baseline/project-schema-baseline.promotion-candidate.sql',
      sha256: sha256(candidate),
      deterministic: true,
      migration: false,
      production_applied: false,
      remote_replay_authorized: false,
      migration_history_alignment_authorized: false,
    },
    object_inventory: objects,
    object_counts: Object.fromEntries(Object.entries(objects).map(([key, values]) => [key, values.length])),
    expected_promotion_comparison: comparison,
    security: {
      rls_auto_enable_present: false,
      security_definer_functions: scan.security_definer_functions,
      project_functions: [],
      public_execute_default_revoked: true,
      application_roles: ['anon', 'authenticated'],
      table_select_relations_per_role: PROJECT_RELATIONS.length,
      table_write_grants_per_role: 0,
      sequence_grants_per_role: 0,
      deals_policy: {
        current_role: 'anon',
        authenticated_visibility: 'no rows under retained production policy',
        decision_status: 'open_product_decision_current_behavior_retained',
      },
    },
    exclusions: {
      scan,
      table_data: true,
      historical_dml: true,
      owners: true,
      role_creation: true,
      credentials: true,
      supabase_internal_ddl: true,
      extension_ddl: true,
      migration_history: true,
      environment_connections: true,
    },
  };
}
