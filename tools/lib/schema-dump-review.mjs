import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function matches(value, pattern) {
  return value.match(pattern)?.length || 0;
}

function sorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

function splitObjectName(value) {
  const separator = value.indexOf(' ');
  return separator < 0
    ? { relation: '', name: value }
    : { relation: value.slice(0, separator), name: value.slice(separator + 1) };
}

function withoutBodiesAndLiterals(sql) {
  return sql
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function parseHeaders(sql) {
  const headers = [];
  const pattern = /^-- Name: (.*); Type: (.*); Schema: (.*); Owner: (.*)$/gm;
  let match;
  while ((match = pattern.exec(sql))) {
    headers.push({ name: match[1], type: match[2], schema: match[3], owner: match[4] });
  }
  return headers;
}

function parsePublicTables(sql) {
  const tables = [];
  const pattern = /^CREATE TABLE public\.(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)) \(\n([\s\S]*?)^\);$/gm;
  let match;
  while ((match = pattern.exec(sql))) {
    const relation = match[1] || match[2];
    const columns = [];
    const constraints = [];
    for (const line of match[3].split('\n')) {
      const constraint = line.match(/^ {4}CONSTRAINT\s+(?:"([^"]+)"|([^\s]+))/);
      if (constraint) {
        constraints.push(`${relation}.${constraint[1] || constraint[2]}`);
        continue;
      }
      const column = line.match(/^ {4}(?! )(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s+/);
      if (column) columns.push(`${relation}.${column[1] || column[2]}`);
    }
    tables.push({ name: relation, columns: sorted(columns), constraints: sorted(constraints) });
  }
  return tables;
}

function typeCounts(headers) {
  const counts = {};
  for (const header of headers) counts[header.type] = (counts[header.type] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

function schemaCounts(headers) {
  const counts = {};
  for (const header of headers) counts[header.schema] = (counts[header.schema] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

function headerNames(headers, type, schema = null) {
  return headers
    .filter(item => item.type === type && (schema == null || item.schema === schema))
    .map(item => item.name);
}

export function parsePgDump(sql, { projectRef = null } = {}) {
  const headers = parseHeaders(sql);
  const publicTables = parsePublicTables(sql);
  const code = withoutBodiesAndLiterals(sql);
  const headerConstraints = headers
    .filter(item => item.schema === 'public' && ['CONSTRAINT', 'CHECK CONSTRAINT', 'FK CONSTRAINT'].includes(item.type))
    .map(item => {
      const { relation, name } = splitObjectName(item.name);
      return `${relation}.${name}`;
    });
  const publicConstraints = sorted([
    ...headerConstraints,
    ...publicTables.flatMap(table => table.constraints),
  ]);

  const dataSignals = {
    data_sections: matches(sql, /^-- Data for Name:/gm),
    copy_from_stdin: matches(code, /^\s*COPY\s+.+\s+FROM\s+stdin;/gmi),
    insert_statements: matches(code, /^\s*INSERT\s+INTO\s+/gmi),
    update_statements: matches(code, /^\s*UPDATE\s+/gmi),
    delete_statements: matches(code, /^\s*DELETE\s+FROM\s+/gmi),
    truncate_statements: matches(code, /^\s*TRUNCATE\s+/gmi),
    sequence_values: matches(code, /^\s*SELECT\s+pg_catalog\.setval\s*\(/gmi),
    large_object_data: matches(code, /\b(?:lo_from_bytea|lo_put)\s*\(/gi),
  };
  const roleAndAclSignals = {
    create_role: matches(code, /^\s*CREATE\s+ROLE\s+/gmi),
    alter_role: matches(code, /^\s*ALTER\s+ROLE\s+/gmi),
    owner_statements: matches(code, /^\s*ALTER\s+.+\s+OWNER\s+TO\s+/gmi),
    grant_statements: matches(code, /^\s*GRANT\s+/gmi),
    revoke_statements: matches(code, /^\s*REVOKE\s+/gmi),
  };
  const credentialSignals = {
    private_keys: matches(sql, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g),
    supabase_secret_keys: matches(sql, /\bsb_secret_[A-Za-z0-9_-]+\b/g),
    jwt_values: matches(sql, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g),
    credential_uris: matches(sql, /(?:postgres(?:ql)?|https?):\/\/[^\s:/]+:[^\s@]+@/gi),
    password_literals: matches(sql, /\b(?:password|passwd)\s*(?:=|TO)\s*'(?:''|[^'])+'/gi),
  };
  const personalDataSignals = {
    email_addresses: matches(sql, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi),
    cpr_candidates: matches(sql, /(?:^|\D)(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[- ]?\d{4}(?:\D|$)/g),
  };
  const environmentSignals = {
    project_ref: projectRef ? matches(sql, new RegExp(`\\b${projectRef}\\b`, 'g')) : 0,
    supabase_hosts: matches(sql, /\b[a-z0-9-]+(?:\.pooler)?\.supabase\.(?:com|co)\b/gi),
    database_settings: matches(code, /^\s*ALTER\s+DATABASE\s+/gmi),
    extension_objects: headerNames(headers, 'EXTENSION').length,
    event_triggers: headerNames(headers, 'EVENT TRIGGER').length,
    publications: headerNames(headers, 'PUBLICATION').length,
    owner_annotations: headers.filter(item => item.owner !== '-').length,
  };

  const publicObjects = {
    schemas: headerNames(headers, 'SCHEMA').filter(name => name === 'public'),
    tables: sorted(headerNames(headers, 'TABLE', 'public')),
    columns: sorted(publicTables.flatMap(table => table.columns)),
    sequences: sorted(headerNames(headers, 'SEQUENCE', 'public')),
    views: sorted(headerNames(headers, 'VIEW', 'public')),
    functions: sorted(headerNames(headers, 'FUNCTION', 'public').map(name => name.replace(/\(.*$/, ''))),
    triggers: sorted(headerNames(headers, 'TRIGGER', 'public').map(name => {
      const item = splitObjectName(name);
      return `${item.relation}.${item.name}`;
    })),
    indexes: sorted(headerNames(headers, 'INDEX', 'public')),
    constraints: publicConstraints,
    policies: sorted(headerNames(headers, 'POLICY', 'public').map(name => {
      const item = splitObjectName(name);
      return `${item.relation}.${item.name}`;
    })),
    row_security: sorted(headerNames(headers, 'ROW SECURITY', 'public')),
  };

  const version = sql.match(/^-- Dumped from database version (.+)$/m)?.[1] || null;
  const clientVersion = sql.match(/^-- Dumped by pg_dump version (.+)$/m)?.[1] || null;
  return {
    server_version: version,
    pg_dump_version: clientVersion,
    header_count: headers.length,
    by_type: typeCounts(headers),
    by_schema: schemaCounts(headers),
    public_objects: publicObjects,
    database_wide_objects: {
      extensions: sorted(headerNames(headers, 'EXTENSION')),
      publications: sorted(headerNames(headers, 'PUBLICATION')),
      event_triggers: sorted(headerNames(headers, 'EVENT TRIGGER')),
    },
    safety_scan: {
      data_signals: dataSignals,
      role_and_acl_signals: roleAndAclSignals,
      credential_signals: credentialSignals,
      personal_data_signals: personalDataSignals,
      environment_signals: environmentSignals,
    },
  };
}

function compareSets(expectedValues, actualValues, allowedMissing = []) {
  const expected = sorted(expectedValues);
  const actual = sorted(actualValues);
  const allowed = new Set(allowedMissing);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter(value => !actualSet.has(value));
  const extra = actual.filter(value => !expectedSet.has(value));
  const unexpectedMissing = missing.filter(value => !allowed.has(value));
  return {
    catalog_count: expected.length,
    dump_count: actual.length,
    missing_in_dump: missing,
    allowed_missing: missing.filter(value => allowed.has(value)),
    extra_in_dump: extra,
    match: unexpectedMissing.length === 0 && extra.length === 0,
  };
}

export function compareDumpToCatalog(parsed, catalog) {
  const constraintNames = new Set((catalog.constraints || []).map(item => item.name));
  const project = parsed.public_objects;
  const ownerCounts = {};
  for (const collection of ['schemas', 'relations', 'functions', 'extensions', 'publications', 'event_triggers']) {
    for (const item of catalog[collection] || []) {
      if (!item.owner) continue;
      const key = `${collection}:${item.owner}`;
      ownerCounts[key] = (ownerCounts[key] || 0) + 1;
    }
  }
  const comparisons = {
    schemas: compareSets((catalog.schemas || []).map(item => item.name), project.schemas, ['public']),
    tables: compareSets(
      (catalog.relations || []).filter(item => ['r', 'p'].includes(item.kind)).map(item => item.name),
      project.tables,
    ),
    columns: compareSets(
      (catalog.columns || [])
        .filter(item => (catalog.relations || []).some(relation => relation.name === item.relation && ['r', 'p'].includes(relation.kind)))
        .map(item => `${item.relation}.${item.name}`),
      project.columns,
    ),
    sequences: compareSets((catalog.sequences || []).map(item => item.name), project.sequences),
    views: compareSets((catalog.views || []).map(item => item.name), project.views),
    functions: compareSets((catalog.functions || []).map(item => item.name), project.functions),
    triggers: compareSets((catalog.triggers || []).map(item => `${item.relation}.${item.name}`), project.triggers),
    indexes: compareSets(
      (catalog.indexes || []).filter(item => !constraintNames.has(item.name)).map(item => item.name),
      project.indexes,
    ),
    constraints: compareSets(
      (catalog.constraints || []).map(item => `${item.relation}.${item.name}`),
      project.constraints,
    ),
    policies: compareSets(
      (catalog.policies || []).map(item => `${item.tablename}.${item.policyname}`),
      project.policies,
    ),
    row_security: compareSets(
      (catalog.relations || []).filter(item => ['r', 'p'].includes(item.kind) && item.row_security).map(item => item.name),
      project.row_security,
    ),
    extensions: compareSets(
      (catalog.extensions || []).map(item => item.name),
      parsed.database_wide_objects.extensions,
      ['plpgsql'],
    ),
    publications: compareSets(
      (catalog.publications || []).map(item => item.name),
      parsed.database_wide_objects.publications,
    ),
    event_triggers: compareSets(
      (catalog.event_triggers || []).map(item => item.name),
      parsed.database_wide_objects.event_triggers,
    ),
  };
  return {
    comparisons,
    all_project_objects_match: Object.entries(comparisons)
      .filter(([name]) => name !== 'extensions')
      .every(([, value]) => value.match),
    extensions_match_with_documented_builtin_exception: comparisons.extensions.match,
    catalog_acl_inventory: {
      database_acl_entries: catalog.database?.acl?.length || 0,
      relation_privilege_entries: catalog.relation_privileges?.length || 0,
      default_acl_entries: catalog.default_acl?.length || 0,
      schema_acl_entries: (catalog.schemas || []).reduce((sum, item) => sum + (item.acl?.length || 0), 0),
      function_acl_entries: (catalog.functions || []).reduce((sum, item) => sum + (item.acl?.length || 0), 0),
      dump_acl_statements_expected: 0,
      reason: '--no-owner and --no-privileges intentionally omit executable owner and ACL statements',
    },
    catalog_owner_inventory: Object.fromEntries(
      Object.entries(ownerCounts).sort(([a], [b]) => a.localeCompare(b, 'en')),
    ),
  };
}

export function anyPositive(object) {
  return Object.values(object).some(value => Number(value) > 0);
}
