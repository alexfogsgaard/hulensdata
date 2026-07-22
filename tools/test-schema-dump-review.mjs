#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compareDumpToCatalog, parsePgDump } from './lib/schema-dump-review.mjs';

const fixture = `--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

-- Name: sample; Type: TABLE; Schema: public; Owner: postgres

CREATE TABLE public.sample (
    id bigint NOT NULL,
    label text,
    CONSTRAINT sample_label_check CHECK ((label <> ''::text))
);

-- Name: sample sample_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres

ALTER TABLE ONLY public.sample
    ADD CONSTRAINT sample_pkey PRIMARY KEY (id);

-- Name: sample; Type: ROW SECURITY; Schema: public; Owner: postgres

ALTER TABLE public.sample ENABLE ROW LEVEL SECURITY;

-- Name: sample anon_read; Type: POLICY; Schema: public; Owner: postgres

CREATE POLICY anon_read ON public.sample FOR SELECT USING (true);
`;

const catalog = {
  schemas: [{ name: 'public', acl: [] }],
  relations: [{ name: 'sample', kind: 'r', row_security: true }],
  columns: [
    { relation: 'sample', name: 'id' },
    { relation: 'sample', name: 'label' },
  ],
  sequences: [],
  views: [],
  functions: [],
  triggers: [],
  indexes: [{ name: 'sample_pkey', primary: true, unique: true }],
  constraints: [
    { relation: 'sample', name: 'sample_label_check' },
    { relation: 'sample', name: 'sample_pkey' },
  ],
  policies: [{ tablename: 'sample', policyname: 'anon_read' }],
  extensions: [{ name: 'plpgsql' }],
  publications: [],
  event_triggers: [],
  relation_privileges: [],
  default_acl: [],
  database: { acl: [] },
};

const parsed = parsePgDump(fixture, { projectRef: 'abcdefghijklmnopqrst' });
const comparison = compareDumpToCatalog(parsed, catalog);
assert.equal(parsed.server_version, '17.6');
assert.equal(parsed.pg_dump_version, '17.10');
assert.deepEqual(parsed.public_objects.tables, ['sample']);
assert.deepEqual(parsed.public_objects.columns, ['sample.id', 'sample.label']);
assert.deepEqual(parsed.public_objects.constraints, ['sample.sample_label_check', 'sample.sample_pkey']);
assert.equal(comparison.all_project_objects_match, true);
assert.equal(comparison.extensions_match_with_documented_builtin_exception, true);
assert.deepEqual(comparison.comparisons.extensions.allowed_missing, ['plpgsql']);

const withData = parsePgDump(`${fixture}\n-- Data for Name: sample; Type: TABLE DATA; Schema: public; Owner: postgres\nCOPY public.sample (id) FROM stdin;\n1\n\\.\n`);
assert.equal(withData.safety_scan.data_signals.data_sections, 1);
assert.equal(withData.safety_scan.data_signals.copy_from_stdin, 1);

const withInsert = parsePgDump(`${fixture}\nINSERT INTO public.sample VALUES (1, 'x');\n`);
assert.equal(withInsert.safety_scan.data_signals.insert_statements, 1);

const functionBodyDml = parsePgDump(`${fixture}\nCREATE FUNCTION public.fixture() RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.sample VALUES (1); END $$;\n`);
assert.equal(functionBodyDml.safety_scan.data_signals.insert_statements, 0, 'DML inside a function definition is schema code, not dumped rows');

const withRole = parsePgDump(`${fixture}\nCREATE ROLE fixture_writer;\nALTER ROLE fixture_writer LOGIN;\n`);
assert.equal(withRole.safety_scan.role_and_acl_signals.create_role, 1);
assert.equal(withRole.safety_scan.role_and_acl_signals.alter_role, 1);

const withAcl = parsePgDump(`${fixture}\nGRANT INSERT ON TABLE public.sample TO fixture_writer;\nREVOKE UPDATE ON TABLE public.sample FROM fixture_writer;\n`);
assert.equal(withAcl.safety_scan.role_and_acl_signals.grant_statements, 1);
assert.equal(withAcl.safety_scan.role_and_acl_signals.revoke_statements, 1);

const withCredential = parsePgDump(`${fixture}\n-- postgres://fixture:do-not-use@example.invalid/postgres\n-- sb_secret_fixture_value\n`);
assert.equal(withCredential.safety_scan.credential_signals.credential_uris, 1);
assert.equal(withCredential.safety_scan.credential_signals.supabase_secret_keys, 1);

const withPersonalData = parsePgDump(`${fixture}\nCOMMENT ON TABLE public.sample IS 'fixture@example.invalid 010190-1234';\n`);
assert.equal(withPersonalData.safety_scan.personal_data_signals.email_addresses, 1);
assert.equal(withPersonalData.safety_scan.personal_data_signals.cpr_candidates, 1);

const withEnvironment = parsePgDump(`${fixture}\nCOMMENT ON TABLE public.sample IS 'abcdefghijklmnopqrst';\n`, { projectRef: 'abcdefghijklmnopqrst' });
assert.equal(withEnvironment.safety_scan.environment_signals.project_ref, 1);

const missingTable = compareDumpToCatalog(parsePgDump(fixture.replace(/sample/g, 'other')), catalog);
assert.equal(missingTable.comparisons.tables.match, false);
assert.deepEqual(missingTable.comparisons.tables.missing_in_dump, ['sample']);
assert.deepEqual(missingTable.comparisons.tables.extra_in_dump, ['other']);

console.log('Schema-dump mutationstests: 9 scenarier grønne');
