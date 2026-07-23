#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { compareToSchemaDumpReview } from './lib/project-baseline-draft.mjs';
import { compareToPromotionInventory } from './lib/project-baseline-promotion.mjs';
import { parsePgDump, sha256 } from './lib/schema-dump-review.mjs';

const root = process.cwd();
const promotionMode = process.argv.includes('--promotion');
const baselinePath = join(root, promotionMode
  ? 'supabase/baseline/project-schema-baseline.promotion-candidate.sql'
  : 'supabase/baseline/project-schema-baseline.draft.sql');
const baselineInventoryPath = join(root, promotionMode
  ? 'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json'
  : 'supabase/baseline/project-schema-baseline.draft.inventory.json');
const reviewPath = join(root, 'supabase/schema-dump-review.json');
const preconditionPath = join(root, 'tools/sql/local-baseline-preconditions.sql');
const aclPath = join(root, 'supabase/baseline/project-schema-acl.contract.draft.sql');
const fixturePath = join(root, 'tools/sql/local-baseline-replay-fixture.sql');

const TABLES = ['companies', 'company_events', 'deal_investors', 'deals', 'investors', 'panel_memberships', 'seasons', 'sources'];
const SELECT_RELATIONS = [...TABLES, 'investor_status'];
const SEQUENCES = ['companies_id_seq', 'company_events_id_seq', 'deals_id_seq', 'investors_id_seq', 'sources_id_seq'];
const UPDATE_COLUMNS = {
  companies: 'name',
  company_events: 'title',
  deal_investors: 'amount',
  deals: 'saeson',
  investors: 'canonical_name',
  panel_memberships: 'role',
  seasons: 'year',
  sources: 'source_name',
};

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function cleanEnvironment() {
  const env = { ...process.env };
  for (const name of [
    'DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'PGHOST',
    'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE',
    'PGSERVICE', 'PGSERVICEFILE',
  ]) delete env[name];
  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: cleanEnvironment(),
    ...options,
  });
  if (!options.allowFailure && result.status !== 0) {
    const message = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`${basename(command)} fejlede (${result.status}): ${message}`);
  }
  return result;
}

function binary(toolchain, name) {
  const path = join(toolchain, 'bin', name);
  if (!existsSync(path)) throw new Error(`PostgreSQL-tool mangler: bin/${name}`);
  return path;
}

function toolVersion(toolchain, name) {
  return run(binary(toolchain, name), ['--version']).stdout.trim();
}

function connectionArgs(socketDir, port) {
  return ['--host', socketDir, '--port', String(port), '--username', 'postgres', '--dbname', 'postgres'];
}

function psql(toolchain, socketDir, port, args, options = {}) {
  return run(binary(toolchain, 'psql'), ['--no-psqlrc', ...connectionArgs(socketDir, port), ...args], options);
}

function queryJson(toolchain, socketDir, port, sql) {
  const result = psql(toolchain, socketDir, port, ['--tuples-only', '--no-align', '--quiet', '--set', 'ON_ERROR_STOP=1', '--command', sql]);
  const line = result.stdout.trim().split('\n').filter(Boolean).at(-1);
  return JSON.parse(line);
}

function queryScalar(toolchain, socketDir, port, sql) {
  const result = psql(toolchain, socketDir, port, ['--tuples-only', '--no-align', '--quiet', '--set', 'ON_ERROR_STOP=1', '--command', sql]);
  return result.stdout.trim().split('\n').filter(Boolean).at(-1) || '';
}

function applySql(toolchain, socketDir, port, path) {
  psql(toolchain, socketDir, port, ['--quiet', '--set', 'ON_ERROR_STOP=1', '--file', path]);
}

function normalizeDump(sql) {
  return `${sql
    .replace(/\r\n?/g, '\n')
    .replace(/^\\(?:un)?restrict\s+.*\n/gm, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()}\n`;
}

function assertNoRemoteMaterial(label, text) {
  const forbidden = /(?:postgres(?:ql)?:\/\/|\.supabase\.(?:com|co)\b|\.pooler\.supabase\.com\b|\b[a-z0-9]{20}\b|sb_secret_|PGPASSFILE)/i;
  if (forbidden.test(text)) throw new Error(`${label} indeholder remote-, credential- eller migrationsmateriale`);
}

function makeValues(values) {
  return values.map(value => `('${value.replaceAll("'", "''")}')`).join(',');
}

function projectOwners(toolchain, socketDir, port) {
  return queryJson(toolchain, socketDir, port, `
    SELECT COALESCE(json_agg(json_build_object('kind', kind, 'object', object_name, 'owner', owner_name) ORDER BY kind, object_name), '[]'::json)
    FROM (
      SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' ELSE c.relkind::text END AS kind,
             n.nspname || '.' || c.relname AS object_name,
             pg_get_userbyid(c.relowner) AS owner_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v')
      UNION ALL
      SELECT 'function', 'public.' || p.proname || '()', pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ) objects;
  `);
}

function functionSecurity(toolchain, socketDir, port) {
  return queryJson(toolchain, socketDir, port, `
    SELECT json_build_object(
      'name', n.nspname || '.' || p.proname || '()',
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'language', l.lanname,
      'return_type', pg_get_function_result(p.oid),
      'arguments', pg_get_function_arguments(p.oid),
      'config', COALESCE(to_json(p.proconfig), '[]'::json),
      'acl_is_null', p.proacl IS NULL,
      'public_execute', has_function_privilege('public', p.oid, 'EXECUTE'),
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable';
  `);
}

function promotionFunctions(toolchain, socketDir, port) {
  return queryJson(toolchain, socketDir, port, `
    SELECT COALESCE(json_agg(json_build_object(
      'name', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      'security_definer', p.prosecdef,
      'public_execute', has_function_privilege('public', p.oid, 'EXECUTE'),
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) ORDER BY p.proname), '[]'::json)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public';
  `);
}

function defaultFunctionPrivilegeProbe(toolchain, socketDir, port) {
  psql(toolchain, socketDir, port, [
    '--quiet', '--set', 'ON_ERROR_STOP=1', '--command',
    "CREATE FUNCTION public.__acl_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1';",
  ]);
  try {
    return queryJson(toolchain, socketDir, port, `
      SELECT json_build_object(
        'public_execute', has_function_privilege('public', 'public.__acl_probe()', 'EXECUTE'),
        'anon_execute', has_function_privilege('anon', 'public.__acl_probe()', 'EXECUTE'),
        'authenticated_execute', has_function_privilege('authenticated', 'public.__acl_probe()', 'EXECUTE')
      );
    `);
  } finally {
    psql(toolchain, socketDir, port, ['--quiet', '--set', 'ON_ERROR_STOP=1', '--command', 'DROP FUNCTION public.__acl_probe();']);
  }
}

function promotionPrivilegeMatrix(toolchain, socketDir, port) {
  const relations = makeValues(SELECT_RELATIONS);
  const sequences = makeValues(SEQUENCES);
  return queryJson(toolchain, socketDir, port, `
    WITH roles(role_name) AS (VALUES ('anon'), ('authenticated')),
    relations(relation_name) AS (VALUES ${relations}),
    sequences(sequence_name) AS (VALUES ${sequences}),
    table_matrix AS (
      SELECT role_name, relation_name,
        has_table_privilege(role_name, 'public.' || relation_name, 'SELECT') AS can_select,
        has_table_privilege(role_name, 'public.' || relation_name, 'INSERT') AS can_insert,
        has_table_privilege(role_name, 'public.' || relation_name, 'UPDATE') AS can_update,
        has_table_privilege(role_name, 'public.' || relation_name, 'DELETE') AS can_delete
      FROM roles CROSS JOIN relations
    ), sequence_matrix AS (
      SELECT role_name, sequence_name,
        has_sequence_privilege(role_name, 'public.' || sequence_name, 'USAGE') AS can_use,
        has_sequence_privilege(role_name, 'public.' || sequence_name, 'SELECT') AS can_select,
        has_sequence_privilege(role_name, 'public.' || sequence_name, 'UPDATE') AS can_update
      FROM roles CROSS JOIN sequences
    )
    SELECT json_build_object(
      'tables', (SELECT json_agg(row_to_json(t) ORDER BY role_name, relation_name) FROM table_matrix t),
      'sequences', (SELECT json_agg(row_to_json(s) ORDER BY role_name, sequence_name) FROM sequence_matrix s),
      'schema', (SELECT json_agg(json_build_object(
        'role_name', role_name,
        'usage', has_schema_privilege(role_name, 'public', 'USAGE'),
        'create', has_schema_privilege(role_name, 'public', 'CREATE')
      ) ORDER BY role_name) FROM roles)
    );
  `);
}

function privilegeMatrix(toolchain, socketDir, port) {
  const relations = makeValues(SELECT_RELATIONS);
  const sequences = makeValues(SEQUENCES);
  return queryJson(toolchain, socketDir, port, `
    WITH roles(role_name) AS (VALUES ('anon'), ('authenticated')),
    relations(relation_name) AS (VALUES ${relations}),
    sequences(sequence_name) AS (VALUES ${sequences}),
    table_matrix AS (
      SELECT role_name, relation_name,
        has_table_privilege(role_name, 'public.' || relation_name, 'SELECT') AS can_select,
        has_table_privilege(role_name, 'public.' || relation_name, 'INSERT') AS can_insert,
        has_table_privilege(role_name, 'public.' || relation_name, 'UPDATE') AS can_update,
        has_table_privilege(role_name, 'public.' || relation_name, 'DELETE') AS can_delete
      FROM roles CROSS JOIN relations
    ), sequence_matrix AS (
      SELECT role_name, sequence_name,
        has_sequence_privilege(role_name, 'public.' || sequence_name, 'USAGE') AS can_use,
        has_sequence_privilege(role_name, 'public.' || sequence_name, 'SELECT') AS can_select,
        has_sequence_privilege(role_name, 'public.' || sequence_name, 'UPDATE') AS can_update
      FROM roles CROSS JOIN sequences
    )
    SELECT json_build_object(
      'tables', (SELECT json_agg(row_to_json(t) ORDER BY role_name, relation_name) FROM table_matrix t),
      'sequences', (SELECT json_agg(row_to_json(s) ORDER BY role_name, sequence_name) FROM sequence_matrix s),
      'schema', (SELECT json_agg(json_build_object(
        'role_name', role_name,
        'usage', has_schema_privilege(role_name, 'public', 'USAGE'),
        'create', has_schema_privilege(role_name, 'public', 'CREATE')
      ) ORDER BY role_name) FROM roles),
      'function', json_build_object(
        'public_execute', has_function_privilege('public', 'public.rls_auto_enable()', 'EXECUTE'),
        'anon_execute', has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'),
        'authenticated_execute', has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')
      )
    );
  `);
}

function rlsAndPolicies(toolchain, socketDir, port) {
  return queryJson(toolchain, socketDir, port, `
    SELECT json_build_object(
      'tables', (SELECT json_agg(json_build_object('table', c.relname, 'enabled', c.relrowsecurity) ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'),
      'policies', (SELECT json_agg(json_build_object(
          'table', tablename, 'name', policyname, 'command', cmd, 'roles', roles,
          'permissive', permissive, 'using', qual, 'with_check', with_check
        ) ORDER BY tablename, policyname)
        FROM pg_policies WHERE schemaname = 'public')
    );
  `);
}

function catalogIntegrity(toolchain, socketDir, port) {
  return queryJson(toolchain, socketDir, port, `
    SELECT json_build_object(
      'physical_table_columns', (
        SELECT count(*) FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      ),
      'constraints', (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'),
      'constraints_validated', (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND c.convalidated),
      'standalone_indexes', (
        SELECT count(*) FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND NOT i.indisprimary AND NOT i.indisunique
      ),
      'standalone_indexes_valid_ready', (
        SELECT count(*) FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND NOT i.indisprimary AND NOT i.indisunique AND i.indisvalid AND i.indisready
      ),
      'user_triggers', (
        SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ),
      'enabled_user_triggers', (
        SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'O'
      ),
      'policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')
    );
  `);
}

function fixtureAssertions(toolchain, socketDir, port) {
  return queryJson(toolchain, socketDir, port, `
    SELECT json_build_object(
      'row_counts', json_build_object(
        'companies', (SELECT count(*) FROM public.companies),
        'company_events', (SELECT count(*) FROM public.company_events),
        'deal_investors', (SELECT count(*) FROM public.deal_investors),
        'deals', (SELECT count(*) FROM public.deals),
        'investors', (SELECT count(*) FROM public.investors),
        'panel_memberships', (SELECT count(*) FROM public.panel_memberships),
        'seasons', (SELECT count(*) FROM public.seasons),
        'sources', (SELECT count(*) FROM public.sources)
      ),
      'generated_aftale', (SELECT aftale FROM public.deals WHERE id = 1),
      'investor_status', (SELECT status FROM public.investor_status WHERE id = 1),
      'company_trigger', (SELECT updated_at > '2000-01-02'::timestamptz FROM public.companies WHERE id = 1),
      'investor_trigger', (SELECT updated_at > '2000-01-02'::timestamptz FROM public.investors WHERE id = 1),
      'event_trigger', (SELECT updated_at > '2000-01-02'::timestamptz FROM public.company_events WHERE id = 1)
    );
  `);
}

function positiveSelects(toolchain, socketDir, port) {
  const results = [];
  for (const role of ['anon', 'authenticated']) {
    for (const relation of SELECT_RELATIONS) {
      const count = Number(queryScalar(toolchain, socketDir, port, `SET ROLE ${role}; SELECT count(*) FROM public.${relation};`));
      results.push({ role, relation, statement_succeeded: true, visible_rows: count });
    }
  }
  return results;
}

function negativeWriteProbes(toolchain, socketDir, port) {
  const results = [];
  for (const role of ['anon', 'authenticated']) {
    for (const table of TABLES) {
      const statements = {
        insert: `INSERT INTO public.${table} DEFAULT VALUES`,
        update: `UPDATE public.${table} SET ${UPDATE_COLUMNS[table]} = ${UPDATE_COLUMNS[table]}`,
        delete: `DELETE FROM public.${table}`,
      };
      for (const [operation, statement] of Object.entries(statements)) {
        const result = psql(toolchain, socketDir, port, [
          '--quiet', '--set', 'ON_ERROR_STOP=1', '--command', `SET ROLE ${role}; ${statement};`,
        ], { allowFailure: true });
        if (result.status === 0) throw new Error(`Uventet write-adgang: ${role} ${operation} public.${table}`);
        const denied = /permission denied|violates row-level security/i.test(`${result.stdout || ''}${result.stderr || ''}`);
        if (!denied) throw new Error(`Write-probe fejlede af ukendt årsag: ${role} ${operation} public.${table}`);
        results.push({ role, table, operation, denied: true });
      }
    }
  }
  return results;
}

function artifact(path) {
  const value = readFileSync(path);
  return { file: basename(path), bytes: value.length, sha256: sha256(value) };
}

function replayRun({ runNumber, toolchain, workDir, review, baselineInventory }) {
  const runDir = mkdtempSync(join(workDir, `run-${runNumber}-`));
  const dataDir = join(runDir, 'cluster');
  const socketDir = mkdtempSync(join(tmpdir(), `hdb-pg-${runNumber}-`));
  const logPath = join(runDir, 'postgres.log');
  const dumpPath = join(runDir, 'project-schema.raw.sql');
  const finalDumpPath = join(runDir, 'project-schema-after-acl.raw.sql');
  const port = 55430 + runNumber;
  let started = false;
  try {
    run(binary(toolchain, 'initdb'), [
      '--pgdata', dataDir,
      '--username', 'postgres',
      '--auth-local', 'trust',
      '--auth-host', 'reject',
      '--encoding', 'UTF8',
      '--locale', 'C',
      '--no-instructions',
    ]);
    run(binary(toolchain, 'pg_ctl'), [
      '--pgdata', dataDir,
      '--log', logPath,
      '--options', `-c listen_addresses='' -c unix_socket_directories='${socketDir}' -c port=${port} -c max_connections=20 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
      '--wait', 'start',
    ]);
    started = true;

    const isolation = queryJson(toolchain, socketDir, port, `
      SELECT json_build_object(
        'server_version', current_setting('server_version'),
        'database', current_database(),
        'user', current_user,
        'inet_server_addr', inet_server_addr(),
        'listen_addresses', current_setting('listen_addresses'),
        'public_relations_before_precondition', (
          SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v')
        )
      );
    `);
    assert.equal(isolation.inet_server_addr, null, 'Serveren må kun være tilgængelig via Unix socket');
    assert.equal(isolation.listen_addresses, '', 'Serveren må ikke lytte på TCP');
    assert.equal(isolation.public_relations_before_precondition, 0, 'Replaytarget skal være uden public projektrelationer');

    applySql(toolchain, socketDir, port, preconditionPath);
    const precondition = queryJson(toolchain, socketDir, port, `
      SELECT json_build_object(
        'anon_role', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon' AND NOT rolsuper AND NOT rolcanlogin AND NOT rolbypassrls),
        'authenticated_role', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated' AND NOT rolsuper AND NOT rolcanlogin AND NOT rolbypassrls),
        'extension_version', (SELECT extversion FROM pg_extension WHERE extname = 'moddatetime'),
        'extension_schema', (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'moddatetime'),
        'function_present', to_regprocedure('extensions.moddatetime()') IS NOT NULL
      );
    `);
    assert.deepEqual(precondition, {
      anon_role: true,
      authenticated_role: true,
      extension_version: '1.0',
      extension_schema: 'extensions',
      function_present: true,
    });

    applySql(toolchain, socketDir, port, baselinePath);
    const baselineRowCount = Number(queryScalar(toolchain, socketDir, port, `
      SELECT
        (SELECT count(*) FROM public.companies) +
        (SELECT count(*) FROM public.company_events) +
        (SELECT count(*) FROM public.deal_investors) +
        (SELECT count(*) FROM public.deals) +
        (SELECT count(*) FROM public.investors) +
        (SELECT count(*) FROM public.panel_memberships) +
        (SELECT count(*) FROM public.seasons) +
        (SELECT count(*) FROM public.sources);
    `));
    assert.equal(baselineRowCount, 0, 'Baseline må ikke indlejre tabeldata');

    run(binary(toolchain, 'pg_dump'), [
      ...connectionArgs(socketDir, port), '--schema-only', '--no-owner', '--no-privileges', '--schema', 'public', '--file', dumpPath,
    ]);
    const rawDump = readFileSync(dumpPath, 'utf8');
    const parsed = parsePgDump(rawDump);
    const comparison = promotionMode
      ? compareToPromotionInventory(parsed.public_objects, review)
      : compareToSchemaDumpReview(parsed.public_objects, review);
    assert.equal(comparison.all_match, true, promotionMode
      ? 'Lokal schemaflade matcher ikke forventet promotion-inventory'
      : 'Lokal schemaflade matcher ikke schema-dump-review.json');
    assert.equal(Object.values(parsed.safety_scan.data_signals).every(value => value === 0), true, 'Schema-only dump indeholder data');
    assert.equal(Object.values(parsed.safety_scan.credential_signals).every(value => value === 0), true, 'Schema-only dump indeholder credentialmønster');
    assert.equal(parsed.safety_scan.role_and_acl_signals.owner_statements, 0);
    assert.equal(parsed.safety_scan.role_and_acl_signals.grant_statements, 0);
    assert.equal(parsed.safety_scan.role_and_acl_signals.revoke_statements, 0);

    const owners = projectOwners(toolchain, socketDir, port);
    assert.equal(owners.length, promotionMode ? 14 : 15, 'Uventet antal project owners');
    assert.equal(owners.every(item => item.owner === 'postgres'), true, 'Uventet lokal project owner');
    let functionBeforeAcl = null;
    let aclBefore = null;
    let directFunctionProbe = null;
    let acl;
    if (promotionMode) {
      const functions = promotionFunctions(toolchain, socketDir, port);
      assert.deepEqual(functions, [], 'Promotion candidate må ikke oprette project-funktioner');
      acl = promotionPrivilegeMatrix(toolchain, socketDir, port);
      directFunctionProbe = defaultFunctionPrivilegeProbe(toolchain, socketDir, port);
      assert.deepEqual(directFunctionProbe, { public_execute: false, anon_execute: false, authenticated_execute: false });
    } else {
      functionBeforeAcl = functionSecurity(toolchain, socketDir, port);
      aclBefore = privilegeMatrix(toolchain, socketDir, port);
      assert.equal(aclBefore.tables.every(item => !item.can_select && !item.can_insert && !item.can_update && !item.can_delete), true, 'Baseline-only må ikke indføre table grants');
      assert.equal(aclBefore.sequences.every(item => !item.can_use && !item.can_select && !item.can_update), true, 'Baseline-only må ikke indføre sequence grants');
      assert.deepEqual(aclBefore.function, { public_execute: true, anon_execute: true, authenticated_execute: true });
      const directFunctionCall = psql(toolchain, socketDir, port, [
        '--quiet', '--set', 'ON_ERROR_STOP=1', '--command', 'SET ROLE anon; SELECT public.rls_auto_enable();',
      ], { allowFailure: true });
      const directFunctionError = `${directFunctionCall.stdout || ''}${directFunctionCall.stderr || ''}`;
      assert.notEqual(directFunctionCall.status, 0, 'Default EXECUTE må ikke give en succesfuld direkte event-trigger-funktionskørsel');
      assert.match(directFunctionError, /event trigger|trigger functions can only be called/i, 'Direkte funktionsprobe fejlede af ukendt årsag');
      directFunctionProbe = {
        attempted_as: 'anon', execute_privilege_present: true, statement_succeeded: false,
        failure_class: 'event_trigger_context_required', write_performed: false,
      };
      applySql(toolchain, socketDir, port, aclPath);
      acl = privilegeMatrix(toolchain, socketDir, port);
    }
    assert.equal(acl.tables.every(item => item.can_select && !item.can_insert && !item.can_update && !item.can_delete), true, 'ACL-matrix afviger');
    assert.equal(acl.sequences.every(item => !item.can_use && !item.can_select && !item.can_update), true, 'Sequence-ACL afviger');
    assert.equal(acl.schema.every(item => item.usage && !item.create), true, 'Schema-ACL afviger');
    if (!promotionMode) assert.deepEqual(acl.function, { public_execute: false, anon_execute: false, authenticated_execute: false });

    applySql(toolchain, socketDir, port, fixturePath);
    const fixture = fixtureAssertions(toolchain, socketDir, port);
    assert.equal(Object.values(fixture.row_counts).every(value => value === 1), true, 'Fixture-rækkeantal afviger');
    assert.equal(fixture.generated_aftale, true);
    assert.equal(fixture.investor_status, 'aktiv');
    assert.equal(fixture.company_trigger && fixture.investor_trigger && fixture.event_trigger, true, 'moddatetime-trigger fejlede');

    const rls = rlsAndPolicies(toolchain, socketDir, port);
    const catalog = catalogIntegrity(toolchain, socketDir, port);
    assert.deepEqual(catalog, {
      physical_table_columns: 59,
      constraints: 26,
      constraints_validated: 26,
      standalone_indexes: 7,
      standalone_indexes_valid_ready: 7,
      user_triggers: 3,
      enabled_user_triggers: 3,
      policies: 8,
    });
    assert.equal(rls.tables.length, 8);
    assert.equal(rls.tables.every(item => item.enabled), true, 'RLS er ikke aktiveret på alle tabeller');
    assert.equal(rls.policies.length, 8);
    const selects = positiveSelects(toolchain, socketDir, port);
    assert.equal(selects.length, 18);
    assert.equal(selects.every(item => item.statement_succeeded), true);
    assert.equal(selects.filter(item => item.role === 'anon').every(item => item.visible_rows === 1), true, 'Anon SELECT-paritet fejlede');
    const authenticatedDeals = selects.find(item => item.role === 'authenticated' && item.relation === 'deals');
    assert.equal(authenticatedDeals.visible_rows, 0, 'Authenticated/deals forventes skjult af den fangede anon-only policy');
    assert.equal(selects.filter(item => item.role === 'authenticated' && item.relation !== 'deals').every(item => item.visible_rows === 1), true);
    const deniedWrites = negativeWriteProbes(toolchain, socketDir, port);
    assert.equal(deniedWrites.length, 48);

    const functionAfterAcl = promotionMode ? promotionFunctions(toolchain, socketDir, port) : functionSecurity(toolchain, socketDir, port);
    run(binary(toolchain, 'pg_dump'), [
      ...connectionArgs(socketDir, port), '--schema-only', '--no-owner', '--no-privileges', '--schema', 'public', '--file', finalDumpPath,
    ]);
    const normalizedBeforeAcl = normalizeDump(rawDump);
    const normalizedAfterAcl = normalizeDump(readFileSync(finalDumpPath, 'utf8'));
    assert.equal(normalizedAfterAcl, normalizedBeforeAcl, 'ACL/fixture ændrede project schema-definitionerne');
    assert.equal(sha256(readFileSync(baselinePath)), promotionMode ? baselineInventory.candidate.sha256 : baselineInventory.draft.sha256, 'Baseline-SQL blev ændret');

    return {
      run: runNumber,
      isolation,
      precondition,
      empty_baseline_row_count: baselineRowCount,
      object_comparison: comparison,
      object_inventory: parsed.public_objects,
      schema_only_scan: parsed.safety_scan,
      owners,
      rls,
      catalog,
      acl_before: aclBefore,
      acl,
      fixture,
      positive_selects: selects,
      negative_write_probes: { attempted: deniedWrites.length, denied: deniedWrites.filter(item => item.denied).length },
      function_before_acl: functionBeforeAcl,
      function_direct_call_before_acl: directFunctionProbe,
      function_after_acl: functionAfterAcl,
      normalized_schema_sha256: sha256(normalizedBeforeAcl),
      raw_artifacts: [artifact(logPath), artifact(dumpPath), artifact(finalDumpPath)],
      run_dir: runDir,
    };
  } finally {
    if (started) run(binary(toolchain, 'pg_ctl'), ['--pgdata', dataDir, '--mode', 'fast', '--wait', 'stop'], { allowFailure: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(socketDir, { recursive: true, force: true });
  }
}

const toolchainArg = arg('--toolchain', process.env.HULENSDATA_PG17_TOOLCHAIN || null);
const workDirArg = arg('--work-dir', join(tmpdir(), 'hulensdata-local-baseline-replay'));
const outputArg = arg('--output', join(root, promotionMode
  ? 'supabase/baseline/promotion-candidate-local-replay-result.json'
  : 'supabase/baseline/local-replay-result.json'));
if (!toolchainArg) throw new Error('Angiv --toolchain eller HULENSDATA_PG17_TOOLCHAIN');
const toolchain = resolve(toolchainArg);
const workDir = resolve(workDirArg);
const outputPath = resolve(outputArg);
if (!isAbsolute(workDir) || relative(root, workDir).split('/')[0] !== '..') throw new Error('Private replayartefakter skal ligge uden for repository');
mkdirSync(workDir, { recursive: true });

const baseline = readFileSync(baselinePath, 'utf8');
const baselineInventoryText = readFileSync(baselineInventoryPath, 'utf8');
const reviewText = readFileSync(reviewPath, 'utf8');
const precondition = readFileSync(preconditionPath, 'utf8');
const acl = promotionMode ? '' : readFileSync(aclPath, 'utf8');
const fixture = readFileSync(fixturePath, 'utf8');
for (const [label, value] of [['baseline', baseline], ['precondition', precondition], ['ACL', acl], ['fixture', fixture]]) assertNoRemoteMaterial(label, value);
const baselineInventory = JSON.parse(baselineInventoryText);
const review = JSON.parse(reviewText);
assert.equal(sha256(baseline), promotionMode ? baselineInventory.candidate.sha256 : baselineInventory.draft.sha256, 'Baselinehash matcher ikke inventory');

const versions = {
  postgres: toolVersion(toolchain, 'postgres'),
  psql: toolVersion(toolchain, 'psql'),
  pg_dump: toolVersion(toolchain, 'pg_dump'),
  initdb: toolVersion(toolchain, 'initdb'),
  pg_ctl: toolVersion(toolchain, 'pg_ctl'),
};
assert.equal(Object.values(versions).every(value => /PostgreSQL\) 17\.10|PostgreSQL 17\.10/.test(value)), true, 'Alle tools skal være PostgreSQL 17.10');
for (const path of [
  join(toolchain, 'share/extension/moddatetime.control'),
  join(toolchain, 'share/extension/moddatetime--1.0.sql'),
]) if (!existsSync(path)) throw new Error(`moddatetime-precondition mangler: ${path}`);
if (![join(toolchain, 'lib/moddatetime.so'), join(toolchain, 'lib/moddatetime.dylib')].some(existsSync)) {
  throw new Error('moddatetime shared library mangler i toolchain/lib');
}

const runs = [1, 2].map(runNumber => replayRun({ runNumber, toolchain, workDir, review, baselineInventory }));
assert.equal(runs[0].normalized_schema_sha256, runs[1].normalized_schema_sha256, 'De to tomme clusters gav forskellig schemahash');
assert.deepEqual(runs[0].object_inventory, runs[1].object_inventory, 'De to tomme clusters gav forskelligt objektinventar');

const source = readFileSync(baselinePath, 'utf8');
const functionBody = source.match(/CREATE FUNCTION public\.rls_auto_enable\(\)[\s\S]*?\n\$\$;/)?.[0] || '';
const draftResult = {
  format_version: 1,
  status: 'local_replay_passed_with_review_findings',
  source_commit: 'd6cfebae23b13022cd5c5cd5cf4671a845acb3f0',
  provenance: {
    method: 'two independent initdb clusters; Unix sockets only; explicit local files',
    database_layer: 'PostgreSQL 17 with Supabase-compatible anon/authenticated roles and moddatetime',
    full_supabase_service_stack_tested: false,
    production_connections: 0,
    remote_supabase_writes: false,
    forbidden_commands_run: [],
    credentials_required: false,
    linked_project_state_used: false,
    local_clusters_created: 2,
    local_clusters_destroyed: 2,
    private_artifacts_committed: false,
  },
  toolchain: {
    versions,
    major_version: 17,
    extension: { name: 'moddatetime', version: '1.0', schema: 'extensions' },
  },
  inputs: {
    baseline_file: 'supabase/baseline/project-schema-baseline.draft.sql',
    baseline_sha256: sha256(baseline),
    baseline_modified: false,
    schema_review_file: 'supabase/schema-dump-review.json',
    schema_review_sha256: sha256(reviewText),
    precondition_file: 'tools/sql/local-baseline-preconditions.sql',
    precondition_sha256: sha256(precondition),
    acl_contract_file: 'supabase/baseline/project-schema-acl.contract.draft.sql',
    acl_contract_sha256: sha256(acl),
    synthetic_fixture_file: 'tools/sql/local-baseline-replay-fixture.sql',
    synthetic_fixture_sha256: sha256(fixture),
  },
  replay: {
    independent_empty_clusters: 2,
    successful_replays: 2,
    empty_before_replay: runs.every(item => item.isolation.public_relations_before_precondition === 0),
    empty_after_baseline: runs.every(item => item.empty_baseline_row_count === 0),
    normalized_schema_sha256: runs[0].normalized_schema_sha256,
    deterministic_final_schema: runs[0].normalized_schema_sha256 === runs[1].normalized_schema_sha256,
    schema_review_all_match: runs.every(item => item.object_comparison.all_match),
    schema_precondition_allowlist: {
      reference_dump_schemas: review.object_inventory.project_schema.schemas,
      local_dump_schemas: runs[0].object_inventory.schemas,
      allowed_local_only: ['public'],
      unexpected: runs[0].object_inventory.schemas.filter(name => name !== 'public'),
    },
    object_comparison: runs[0].object_comparison,
    object_inventory: runs[0].object_inventory,
    schema_only_data_signals: runs[0].schema_only_scan.data_signals,
  },
  security_tests: {
    rls_enabled_tables: runs[0].rls.tables.filter(item => item.enabled).map(item => item.table),
    policies: runs[0].rls.policies,
    select_statements_attempted: runs[0].positive_selects.length,
    select_statements_succeeded: runs[0].positive_selects.filter(item => item.statement_succeeded).length,
    anon_relations_with_visible_fixture: runs[0].positive_selects.filter(item => item.role === 'anon' && item.visible_rows === 1).length,
    authenticated_relations_with_visible_fixture: runs[0].positive_selects.filter(item => item.role === 'authenticated' && item.visible_rows === 1).length,
    authenticated_deals_visible_rows: runs[0].positive_selects.find(item => item.role === 'authenticated' && item.relation === 'deals').visible_rows,
    negative_writes_attempted: runs[0].negative_write_probes.attempted,
    negative_writes_denied: runs[0].negative_write_probes.denied,
    unexpected_write_privileges: runs[0].acl.tables.filter(item => item.can_insert || item.can_update || item.can_delete).length,
    unexpected_sequence_privileges: runs[0].acl.sequences.filter(item => item.can_use || item.can_select || item.can_update).length,
    expected_local_owners_only: runs[0].owners.every(item => item.owner === 'postgres'),
    owner_inventory: runs[0].owners,
    catalog_integrity: runs[0].catalog,
    baseline_privilege_matrix: runs[0].acl_before,
    acl_contract_privilege_matrix: runs[0].acl,
    fixture_contract: runs[0].fixture,
  },
  security_definer_review: {
    observed_before_acl: runs[0].function_before_acl,
    observed_after_acl: runs[0].function_after_acl,
    direct_call_before_acl: runs[0].function_direct_call_before_acl,
    source_sha256: sha256(functionBody),
    no_arguments: true,
    input_surface: 'server-generated pg_event_trigger_ddl_commands() rows for CREATE TABLE-like DDL in public; no direct SQL arguments',
    dynamic_sql: "format('alter table if exists %s enable row level security', cmd.object_identity)",
    search_path_assessment: 'fixed pg_catalog search_path is appropriate and blocks caller-controlled object shadowing',
    security_definer_need: 'not demonstrated; the event trigger is excluded and every baseline table enables RLS explicitly',
    recommendation: 'remove_before_promotion',
    rationale: 'The function is inert without ensure_rls, defaults to PUBLIC EXECUTE before ACL, and duplicates explicit RLS DDL. Retain only after a separate event-trigger requirement and dedicated-owner design are approved.',
  },
  acl_contract: {
    status: 'draft_applied_locally_only',
    production_applied: false,
    table_select_grants_per_role: 9,
    table_write_grants_per_role: 0,
    sequence_grants_per_role: 0,
    public_schema_create_for_application_roles: false,
    rls_function_execute_for_public_roles: false,
  },
  findings: [
    {
      severity: 'review_required',
      code: 'DEFAULT_PUBLIC_EXECUTE',
      summary: 'Baseline-only replay gives PUBLIC/anon/authenticated EXECUTE on rls_auto_enable() via PostgreSQL defaults; direct invocation cannot enter event-trigger context, and the local ACL draft revokes it.',
    },
    {
      severity: 'review_required',
      code: 'SECURITY_DEFINER_REMOVE',
      summary: 'Remove rls_auto_enable() from the promoted baseline unless an event-trigger requirement is separately approved.',
    },
    {
      severity: 'known_policy_asymmetry',
      code: 'AUTHENTICATED_DEALS_POLICY',
      summary: 'The captured deals policy targets anon only; authenticated SELECT succeeds but sees zero fixture rows while the other eight relations are visible.',
    },
    {
      severity: 'toolchain_limit',
      code: 'DATABASE_LAYER_ONLY',
      summary: 'No Docker/Supabase CLI was available, so Auth, REST, Storage and gateway services were not exercised.',
    },
  ],
};

const result = promotionMode ? {
  format_version: 1,
  status: 'promotion_candidate_local_replay_passed_not_applied',
  source_commit: 'bd15a8a24403599271908efe16245807b6afed99',
  provenance: {
    method: 'two independent empty initdb clusters; Unix sockets only; integrated candidate ACL',
    database_layer: 'PostgreSQL 17 with Supabase-compatible anon/authenticated roles and moddatetime',
    full_supabase_service_stack_tested: false,
    production_connections: 0,
    remote_supabase_writes: false,
    forbidden_commands_run: [],
    credentials_required: false,
    linked_project_state_used: false,
    local_clusters_created: 2,
    local_clusters_destroyed: 2,
    private_artifacts_committed: false,
    production_applied: false,
    migration_history_changed: false,
  },
  toolchain: {
    versions,
    major_version: 17,
    extension: { name: 'moddatetime', version: '1.0', schema: 'extensions' },
  },
  inputs: {
    candidate_file: 'supabase/baseline/project-schema-baseline.promotion-candidate.sql',
    candidate_sha256: sha256(baseline),
    candidate_modified_during_replay: false,
    candidate_inventory_file: 'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json',
    candidate_inventory_sha256: sha256(baselineInventoryText),
    source_draft_sha256: baselineInventory.provenance.source_draft_sha256,
    schema_review_file: 'supabase/schema-dump-review.json',
    schema_review_sha256: sha256(reviewText),
    precondition_file: 'tools/sql/local-baseline-preconditions.sql',
    precondition_sha256: sha256(precondition),
    synthetic_fixture_file: 'tools/sql/local-baseline-replay-fixture.sql',
    synthetic_fixture_sha256: sha256(fixture),
  },
  replay: {
    independent_empty_clusters: 2,
    successful_replays: 2,
    empty_before_replay: runs.every(item => item.isolation.public_relations_before_precondition === 0),
    empty_after_candidate: runs.every(item => item.empty_baseline_row_count === 0),
    normalized_schema_sha256: runs[0].normalized_schema_sha256,
    run_schema_sha256: runs.map(item => item.normalized_schema_sha256),
    deterministic_final_schema: runs[0].normalized_schema_sha256 === runs[1].normalized_schema_sha256,
    promotion_inventory_all_match: runs.every(item => item.object_comparison.all_match),
    expected_difference_from_production_capture: {
      functions_removed: ['rls_auto_enable'],
      other_object_differences: [],
    },
    object_comparison: runs[0].object_comparison,
    object_inventory: runs[0].object_inventory,
    schema_only_data_signals: runs[0].schema_only_scan.data_signals,
    schema_only_credential_signals: runs[0].schema_only_scan.credential_signals,
    schema_only_owner_statements: runs[0].schema_only_scan.role_and_acl_signals.owner_statements,
  },
  security_tests: {
    rls_enabled_tables: runs[0].rls.tables.filter(item => item.enabled).map(item => item.table),
    policies: runs[0].rls.policies,
    project_functions: runs[0].function_after_acl,
    security_definer_functions: runs[0].function_after_acl.filter(item => item.security_definer).length,
    default_function_privilege_probe: runs[0].function_direct_call_before_acl,
    select_statements_attempted: runs[0].positive_selects.length,
    select_statements_succeeded: runs[0].positive_selects.filter(item => item.statement_succeeded).length,
    anon_relations_with_visible_fixture: runs[0].positive_selects.filter(item => item.role === 'anon' && item.visible_rows === 1).length,
    authenticated_relations_with_visible_fixture: runs[0].positive_selects.filter(item => item.role === 'authenticated' && item.visible_rows === 1).length,
    authenticated_deals_visible_rows: runs[0].positive_selects.find(item => item.role === 'authenticated' && item.relation === 'deals').visible_rows,
    negative_writes_attempted: runs[0].negative_write_probes.attempted,
    negative_writes_denied: runs[0].negative_write_probes.denied,
    unexpected_table_privileges: runs[0].acl.tables.filter(item => !item.can_select || item.can_insert || item.can_update || item.can_delete).length,
    unexpected_sequence_privileges: runs[0].acl.sequences.filter(item => item.can_use || item.can_select || item.can_update).length,
    unexpected_schema_privileges: runs[0].acl.schema.filter(item => !item.usage || item.create).length,
    privilege_matrix: runs[0].acl,
    owner_inventory: runs[0].owners,
    owner_statements_in_candidate: 0,
    fixture_contract: runs[0].fixture,
    catalog_integrity: runs[0].catalog,
  },
  acl_contract: {
    status: 'integrated_in_promotion_candidate_locally_replayed_not_applied',
    production_applied: false,
    runtime_roles: ['anon', 'authenticated'],
    relation_select_grants_per_role: 9,
    table_write_grants_per_role: 0,
    sequence_grants_per_role: 0,
    schema_usage: true,
    schema_create: false,
    project_function_count: 0,
    public_execute_on_future_project_functions: false,
  },
  deals_policy_review: {
    status: 'open_product_decision_current_behavior_retained',
    captured_policy: 'FOR SELECT TO anon USING (true)',
    anon_fixture_rows: 1,
    authenticated_fixture_rows: 0,
    proven: 'production capture and migration evidence target anon; repository runtime uses the public anon client path',
    not_proven: 'that excluding authenticated was an intentional product requirement rather than historical inconsistency',
    candidate_action: 'retain current policy without guessing; require explicit product/security decision before change',
  },
  blockers_before_promotion: [
    'Resolve the authenticated/deals policy role as an explicit product and security decision.',
    'Run an independent review of the candidate and ACL contract.',
    'Test the candidate in an unlinked full Supabase service stack before any remote migration plan.',
    'Design and approve migration-history alignment separately; this candidate does not perform it.',
  ],
} : draftResult;

assertNoRemoteMaterial('sanitiseret resultat', JSON.stringify(result));
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

const privateManifest = {
  format_version: 1,
  private: true,
  output_sha256: sha256(JSON.stringify(result)),
  runs: runs.map(item => ({ run: item.run, directory: item.run_dir, artifacts: item.raw_artifacts })),
  clusters_destroyed: true,
};
const manifestPath = join(workDir, 'private-manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(privateManifest, null, 2)}\n`);
chmodSync(manifestPath, 0o600);

console.log(`${promotionMode ? 'Promotion-candidate-replay' : 'Lokal baseline-replay'}: 2/2 grønne · schema ${result.replay.normalized_schema_sha256} · 48/48 writes afvist · clusters slettet`);
console.log(`Privat manifest: ${manifestPath}`);
