import { parsePublicTables, sha256 } from './schema-dump-review.mjs';

export const BASELINE_PHASES = [
  {
    id: '01_function',
    label: 'Project function',
    objects: [
      ['FUNCTION', 'rls_auto_enable()'],
    ],
  },
  {
    id: '02_tables_and_sequences',
    label: 'Tables and sequence/default wiring',
    objects: [
      ['TABLE', 'companies'],
      ['SEQUENCE', 'companies_id_seq'],
      ['TABLE', 'investors'],
      ['SEQUENCE', 'investors_id_seq'],
      ['TABLE', 'seasons'],
      ['TABLE', 'deals'],
      ['SEQUENCE', 'deals_id_seq'],
      ['SEQUENCE OWNED BY', 'deals_id_seq'],
      ['DEFAULT', 'deals id'],
      ['TABLE', 'company_events'],
      ['SEQUENCE', 'company_events_id_seq'],
      ['TABLE', 'panel_memberships'],
      ['TABLE', 'deal_investors'],
      ['TABLE', 'sources'],
      ['SEQUENCE', 'sources_id_seq'],
    ],
  },
  {
    id: '03_primary_and_unique_constraints',
    label: 'Primary-key and unique constraints',
    objects: [
      ['CONSTRAINT', 'companies companies_name_key'],
      ['CONSTRAINT', 'companies companies_pkey'],
      ['CONSTRAINT', 'companies companies_slug_key'],
      ['CONSTRAINT', 'investors investors_canonical_name_key'],
      ['CONSTRAINT', 'investors investors_pkey'],
      ['CONSTRAINT', 'investors investors_slug_key'],
      ['CONSTRAINT', 'seasons seasons_pkey'],
      ['CONSTRAINT', 'deals deals_pkey'],
      ['CONSTRAINT', 'company_events company_events_pkey'],
      ['CONSTRAINT', 'panel_memberships panel_memberships_pkey'],
      ['CONSTRAINT', 'deal_investors deal_investors_pkey'],
      ['CONSTRAINT', 'sources sources_pkey'],
    ],
  },
  {
    id: '04_foreign_keys',
    label: 'Foreign-key constraints',
    objects: [
      ['FK CONSTRAINT', 'company_events company_events_company_id_fkey'],
      ['FK CONSTRAINT', 'deals deals_company_id_fkey'],
      ['FK CONSTRAINT', 'panel_memberships panel_memberships_investor_id_fkey'],
      ['FK CONSTRAINT', 'panel_memberships panel_memberships_season_number_fkey'],
      ['FK CONSTRAINT', 'deal_investors deal_investors_deal_id_fkey'],
      ['FK CONSTRAINT', 'deal_investors deal_investors_investor_id_fkey'],
    ],
  },
  {
    id: '05_indexes',
    label: 'Standalone indexes',
    objects: [
      ['INDEX', 'company_events_company_idx'],
      ['INDEX', 'deal_investors_investor_id_idx'],
      ['INDEX', 'deals_company_id_idx'],
      ['INDEX', 'idx_deals_aftale'],
      ['INDEX', 'idx_deals_saeson'],
      ['INDEX', 'panel_memberships_investor_id_idx'],
      ['INDEX', 'sources_entity_idx'],
    ],
  },
  {
    id: '06_view',
    label: 'Security-invoker view',
    objects: [
      ['VIEW', 'investor_status'],
    ],
  },
  {
    id: '07_triggers',
    label: 'Updated-at triggers',
    objects: [
      ['TRIGGER', 'companies set_updated_at'],
      ['TRIGGER', 'company_events set_updated_at'],
      ['TRIGGER', 'investors set_updated_at'],
    ],
  },
  {
    id: '08_row_security',
    label: 'RLS enablement',
    objects: [
      ['ROW SECURITY', 'companies'],
      ['ROW SECURITY', 'company_events'],
      ['ROW SECURITY', 'deal_investors'],
      ['ROW SECURITY', 'deals'],
      ['ROW SECURITY', 'investors'],
      ['ROW SECURITY', 'panel_memberships'],
      ['ROW SECURITY', 'seasons'],
      ['ROW SECURITY', 'sources'],
    ],
  },
  {
    id: '09_policies',
    label: 'Read policies',
    objects: [
      ['POLICY', 'companies anon_read'],
      ['POLICY', 'company_events anon_read'],
      ['POLICY', 'deal_investors anon_read'],
      ['POLICY', 'deals Public read access'],
      ['POLICY', 'investors anon_read'],
      ['POLICY', 'panel_memberships anon_read'],
      ['POLICY', 'seasons anon_read'],
      ['POLICY', 'sources anon_read'],
    ],
  },
];

function sorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

function count(value, pattern) {
  return value.match(pattern)?.length || 0;
}

function stripBodiesAndLiterals(sql) {
  return sql
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function normalizeBody(body) {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

export function parseDumpSections(sql) {
  const headers = [];
  const pattern = /^-- Name: (.*); Type: (.*); Schema: (.*); Owner: (.*)$/gm;
  let match;
  while ((match = pattern.exec(sql))) {
    const bodyStartMarker = sql.indexOf('\n--\n\n', pattern.lastIndex);
    if (bodyStartMarker < 0) throw new Error(`Kan ikke finde body for ${match[2]} ${match[1]}`);
    const bodyStart = bodyStartMarker + '\n--\n\n'.length;
    const nextSection = sql.indexOf('\n\n--\n-- TOC entry', bodyStart);
    const dumpEnd = sql.indexOf('\n\n-- PostgreSQL database dump complete', bodyStart);
    const candidates = [nextSection, dumpEnd].filter(index => index >= 0);
    const bodyEnd = candidates.length ? Math.min(...candidates) : sql.length;
    headers.push({
      name: match[1],
      type: match[2],
      schema: match[3],
      owner: match[4],
      body: normalizeBody(sql.slice(bodyStart, bodyEnd)),
    });
  }
  return headers;
}

function sectionKey(type, name) {
  return `${type}\u0000${name}`;
}

export function selectProjectSections(rawDump) {
  const sections = parseDumpSections(rawDump);
  const selected = new Map();
  for (const section of sections) {
    if (section.schema !== 'public') continue;
    const key = sectionKey(section.type, section.name);
    if (selected.has(key)) throw new Error(`Dubleret dumpsektion: ${section.type} ${section.name}`);
    selected.set(key, section);
  }

  const expectedKeys = BASELINE_PHASES.flatMap(phase => phase.objects.map(([type, name]) => sectionKey(type, name)));
  for (const key of expectedKeys) {
    if (!selected.has(key)) {
      const [type, name] = key.split('\u0000');
      throw new Error(`Manglende projektsektion: ${type} ${name}`);
    }
  }
  const unexpected = [...selected.keys()].filter(key => !expectedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`Uklassificerede public-sektioner: ${unexpected.map(key => key.replace('\u0000', ' ')).join(', ')}`);
  }
  return selected;
}

function baselineHeader(reviewText, review) {
  const rawDumpHash = review.private_artifacts?.dump?.sha256;
  if (!/^[a-f0-9]{64}$/.test(rawDumpHash || '')) throw new Error('Schema-dump-review mangler raw dump SHA-256');
  return `-- =============================================================================
-- HULENSDATA PROJECT SCHEMA BASELINE — DRAFT ONLY / DO NOT REPLAY
-- =============================================================================
-- Deterministically derived from the verified private PostgreSQL 17 schema dump.
-- Sanitized review: supabase/schema-dump-review.json
-- Sanitized review SHA-256: ${sha256(reviewText)}
-- Private source dump SHA-256: ${rawDumpHash}
-- Source gate commit: 14c53540d0d465745e41670b84a5462178fb9205
--
-- Included: public tables, sequences/default wiring, view, project function,
-- triggers, standalone indexes, constraints, RLS enablement, and RLS policies.
-- Excluded: table rows, historical DML, owners, grants/revokes, credentials,
-- custom roles, extension DDL, Supabase-managed schemas/objects, publications,
-- event triggers, migration history, and connection/environment configuration.
--
-- External preconditions intentionally NOT created here:
--   * an existing public schema;
--   * PostgreSQL 17-compatible runtime;
--   * extensions.moddatetime(text) for the three updated_at triggers;
--   * a separately reviewed least-privilege ACL contract.
--
-- STOP BOUNDARY: this file has not been replayed. It is not a migration and is
-- not authorized for db push, migration repair, remote history alignment, or
-- production execution. The public SECURITY DEFINER event-trigger function is
-- preserved for fidelity but remains a replay blocker until ACL/function scope
-- is explicitly reviewed in an isolated local gate.
-- =============================================================================`;
}

export function buildProjectBaselineDraft(rawDump, reviewText) {
  const review = JSON.parse(reviewText);
  const selected = selectProjectSections(rawDump);
  const parts = [baselineHeader(reviewText, review)];
  for (const phase of BASELINE_PHASES) {
    parts.push(`-- phase: ${phase.id}\n-- ${phase.label}`);
    for (const [type, name] of phase.objects) {
      const section = selected.get(sectionKey(type, name));
      parts.push(`-- object: ${type} public.${name}\n${section.body}`);
    }
  }
  return `${parts.join('\n\n')}\n`;
}

export function parseBaselineObjects(sql) {
  const tables = parsePublicTables(sql);
  const tableNames = tables.map(table => table.name);
  const sequenceNames = [
    ...[...sql.matchAll(/^CREATE SEQUENCE public\.([a-z_][a-z0-9_]*)/gm)].map(match => match[1]),
    ...[...sql.matchAll(/^\s+SEQUENCE NAME public\.([a-z_][a-z0-9_]*)$/gm)].map(match => match[1]),
  ];
  const addedConstraints = [...sql.matchAll(/^ALTER TABLE ONLY public\.([a-z_][a-z0-9_]*)\n\s+ADD CONSTRAINT (?:(?:"([^"]+)")|([a-z_][a-z0-9_]*))/gm)]
    .map(match => `${match[1]}.${match[2] || match[3]}`);
  const policies = [...sql.matchAll(/^CREATE POLICY (?:(?:"([^"]+)")|([a-z_][a-z0-9_]*)) ON public\.([a-z_][a-z0-9_]*)/gm)]
    .map(match => `${match[3]}.${match[1] || match[2]}`);
  const triggers = [...sql.matchAll(/^CREATE TRIGGER (?:(?:"([^"]+)")|([a-z_][a-z0-9_]*)) .* ON public\.([a-z_][a-z0-9_]*) /gm)]
    .map(match => `${match[3]}.${match[1] || match[2]}`);
  return {
    tables: sorted(tableNames),
    columns: sorted(tables.flatMap(table => table.columns)),
    sequences: sorted(sequenceNames),
    views: sorted([...sql.matchAll(/^CREATE VIEW public\.([a-z_][a-z0-9_]*)/gm)].map(match => match[1])),
    functions: sorted([...sql.matchAll(/^CREATE FUNCTION public\.([a-z_][a-z0-9_]*)\s*\(/gm)].map(match => match[1])),
    triggers: sorted(triggers),
    indexes: sorted([...sql.matchAll(/^CREATE (?:UNIQUE )?INDEX ([a-z_][a-z0-9_]*) ON public\./gm)].map(match => match[1])),
    constraints: sorted([...tables.flatMap(table => table.constraints), ...addedConstraints]),
    policies: sorted(policies),
    row_security: sorted([...sql.matchAll(/^ALTER TABLE public\.([a-z_][a-z0-9_]*) ENABLE ROW LEVEL SECURITY;/gm)].map(match => match[1])),
  };
}

export function scanBaseline(sql) {
  const code = stripBodiesAndLiterals(sql);
  const forbiddenSchemas = ['auth', 'storage', 'realtime', 'supabase_migrations', 'graphql_public', 'pgbouncer'];
  return {
    data: {
      data_sections: count(sql, /^-- Data for Name:/gm),
      copy_from_stdin: count(code, /^\s*COPY\s+.+\s+FROM\s+stdin;/gmi),
      insert: count(code, /^\s*INSERT\s+INTO\s+/gmi),
      update: count(code, /^\s*UPDATE\s+/gmi),
      delete: count(code, /^\s*DELETE\s+FROM\s+/gmi),
      truncate: count(code, /^\s*TRUNCATE\s+/gmi),
      sequence_values: count(code, /^\s*SELECT\s+pg_catalog\.setval\s*\(/gmi),
    },
    credentials: {
      private_keys: count(sql, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g),
      supabase_secret_keys: count(sql, /\bsb_secret_[A-Za-z0-9_-]+\b/g),
      jwt_values: count(sql, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g),
      credential_uris: count(sql, /(?:postgres(?:ql)?|https?):\/\/[^\s:/]+:[^\s@]+@/gi),
      password_literals: count(sql, /\b(?:password|passwd)\s*(?:=|TO)\s*'(?:''|[^'])+'/gi),
    },
    privileges: {
      owner_statements: count(code, /^\s*ALTER\s+.+\s+OWNER\s+TO\s+/gmi),
      grant_statements: count(code, /^\s*GRANT\s+/gmi),
      revoke_statements: count(code, /^\s*REVOKE\s+/gmi),
      create_role: count(code, /^\s*CREATE\s+ROLE\s+/gmi),
      alter_role: count(code, /^\s*ALTER\s+ROLE\s+/gmi),
    },
    platform: {
      forbidden_schema_references: Object.fromEntries(forbiddenSchemas.map(schema => [
        schema,
        count(code, new RegExp(`\\b${schema.replace('_', '\\_')}\\.`, 'gi')),
      ])),
      create_schema: count(code, /^\s*CREATE\s+SCHEMA\s+/gmi),
      create_extension: count(code, /^\s*CREATE\s+EXTENSION\s+/gmi),
      plpgsql_extension_ddl: count(code, /^\s*CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?plpgsql["']?/gmi),
      event_trigger_ddl: count(code, /^\s*CREATE\s+EVENT\s+TRIGGER\s+/gmi),
      publication_ddl: count(code, /^\s*CREATE\s+PUBLICATION\s+/gmi),
      migration_history_references: count(code, /\b(?:supabase_migrations|schema_migrations|migration\s+repair)\b/gi),
      moddatetime_references: count(code, /\bextensions\.moddatetime\s*\(/g),
      other_extension_references: count(code, /\bextensions\.(?!moddatetime\b)[a-z_][a-z0-9_]*\b/gi),
      connection_references: count(sql, /\b(?:postgres(?:ql)?:\/\/|[a-z0-9-]+\.pooler\.supabase\.com|[a-z0-9-]+\.supabase\.co)\b/gi),
      project_ref_candidates: count(sql, /\b[a-z0-9]{20}\b/g),
    },
    security_definer_functions: count(code, /\bSECURITY\s+DEFINER\b/gi),
  };
}

function compareSets(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter(item => !actualSet.has(item));
  const extra = actual.filter(item => !expectedSet.has(item));
  return { expected_count: expected.length, actual_count: actual.length, missing, extra, match: missing.length === 0 && extra.length === 0 };
}

export function compareToSchemaDumpReview(objects, review) {
  const expected = review.object_inventory?.project_schema;
  if (!expected) throw new Error('Schema-dump-review mangler project_schema inventory');
  const comparisons = {};
  for (const key of ['tables', 'columns', 'sequences', 'views', 'functions', 'triggers', 'indexes', 'constraints', 'policies', 'row_security']) {
    comparisons[key] = compareSets(expected[key] || [], objects[key] || []);
  }
  return {
    comparisons,
    all_match: Object.values(comparisons).every(item => item.match),
  };
}

export function phaseOrder(sql) {
  return BASELINE_PHASES.map(phase => ({
    id: phase.id,
    index: sql.indexOf(`-- phase: ${phase.id}`),
    object_count: phase.objects.length,
  }));
}

export function allZero(object) {
  return Object.values(object).every(value => typeof value === 'object' ? allZero(value) : Number(value) === 0);
}
