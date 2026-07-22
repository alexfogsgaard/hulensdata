select jsonb_build_object(
  'capture_version', 1,
  'captured_at', clock_timestamp(),
  'project_ref', 'upaxzfytumsijnbhjihd',
  'method', 'Supabase MCP execute_sql; one read-only pg_catalog/information_schema SELECT',
  'scope', jsonb_build_object(
    'project_schema', 'public',
    'database_wide', jsonb_build_array(
      'installed extensions', 'event triggers', 'default ACLs',
      'publications', 'database properties'
    ),
    'excludes', jsonb_build_array(
      'table row data', 'auth/storage rows', 'role passwords', 'server files',
      'WAL', 'physical backup'
    )
  ),
  'server', jsonb_build_object(
    'version', current_setting('server_version'),
    'version_num', current_setting('server_version_num'),
    'database', current_database(),
    'current_user', current_user,
    'session_user', session_user,
    'search_path', current_setting('search_path')
  ),
  'database', (
    select jsonb_build_object(
      'name', d.datname,
      'owner', pg_get_userbyid(d.datdba),
      'encoding', pg_encoding_to_char(d.encoding),
      'collate', d.datcollate,
      'ctype', d.datctype,
      'locale_provider', d.datlocprovider,
      'locale', d.datlocale,
      'icu_rules', d.daticurules,
      'collation_version', d.datcollversion,
      'acl', coalesce(
        (select jsonb_agg(x::text order by x::text) from unnest(d.datacl) x),
        '[]'::jsonb
      ),
      'connection_limit', d.datconnlimit,
      'allow_connections', d.datallowconn,
      'is_template', d.datistemplate,
      'tablespace', ts.spcname,
      'settings', (
        select coalesce(jsonb_agg(s order by s), '[]'::jsonb)
        from pg_db_role_setting rs cross join lateral unnest(rs.setconfig) s
        where rs.setdatabase=d.oid and rs.setrole=0
      ),
      'comment', obj_description(d.oid, 'pg_database')
    )
    from pg_database d
    join pg_tablespace ts on ts.oid=d.dattablespace
    where d.datname=current_database()
  ),
  'schemas', (
    select jsonb_agg(jsonb_build_object(
      'name', n.nspname,
      'owner', pg_get_userbyid(n.nspowner),
      'acl', coalesce(
        (select jsonb_agg(x::text order by x::text) from unnest(n.nspacl) x),
        '[]'::jsonb
      ),
      'comment', obj_description(n.oid, 'pg_namespace')
    ) order by n.nspname)
    from pg_namespace n where n.nspname='public'
  ),
  'extensions', (
    select jsonb_agg(jsonb_build_object(
      'name', e.extname,
      'version', e.extversion,
      'schema', n.nspname,
      'owner', pg_get_userbyid(e.extowner),
      'relocatable', e.extrelocatable,
      'config_relations', e.extconfig,
      'config_conditions', e.extcondition,
      'comment', obj_description(e.oid, 'pg_extension')
    ) order by e.extname)
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  ),
  'types', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', t.typname,
      'kind', t.typtype,
      'category', t.typcategory,
      'owner', pg_get_userbyid(t.typowner),
      'not_null', t.typnotnull,
      'default', t.typdefault,
      'base_type', case
        when t.typbasetype <> 0 then format_type(t.typbasetype, t.typtypmod)
      end,
      'collation', case
        when t.typcollation <> 0 then t.typcollation::regcollation::text
      end,
      'acl', coalesce(
        (select jsonb_agg(x::text order by x::text) from unnest(t.typacl) x),
        '[]'::jsonb
      ),
      'enum_labels', (
        select jsonb_agg(en.enumlabel order by en.enumsortorder)
        from pg_enum en where en.enumtypid=t.oid
      ),
      'comment', obj_description(t.oid, 'pg_type')
    ) order by t.typname), '[]'::jsonb)
    from pg_type t
    join pg_namespace n on n.oid=t.typnamespace
    left join pg_class c on c.oid=t.typrelid
    where n.nspname='public'
      and (t.typtype in ('e','d','r') or (t.typtype='c' and c.relkind='c'))
  ),
  'relations', (
    select jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'kind', c.relkind,
      'persistence', c.relpersistence,
      'owner', pg_get_userbyid(c.relowner),
      'row_security', c.relrowsecurity,
      'force_row_security', c.relforcerowsecurity,
      'replica_identity', c.relreplident,
      'options', c.reloptions,
      'acl', coalesce(
        (select jsonb_agg(x::text order by x::text) from unnest(c.relacl) x),
        '[]'::jsonb
      ),
      'partition_key', pg_get_partkeydef(c.oid),
      'partition_bound', pg_get_expr(c.relpartbound, c.oid),
      'tablespace', (
        select spcname from pg_tablespace where oid=c.reltablespace
      ),
      'comment', obj_description(c.oid, 'pg_class')
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
  ),
  'columns', (
    select jsonb_agg(jsonb_build_object(
      'relation', c.relname,
      'ordinal', a.attnum,
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull,
      'identity', a.attidentity,
      'generated', a.attgenerated,
      'default', pg_get_expr(ad.adbin, ad.adrelid),
      'collation', case
        when a.attcollation <> 0 then a.attcollation::regcollation::text
      end,
      'storage', a.attstorage,
      'compression', a.attcompression,
      'statistics_target', a.attstattarget,
      'acl', coalesce(
        (select jsonb_agg(x::text order by x::text) from unnest(a.attacl) x),
        '[]'::jsonb
      ),
      'comment', col_description(c.oid, a.attnum)
    ) order by c.relname, a.attnum)
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
      and a.attnum>0 and not a.attisdropped
  ),
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'relation', c.relname,
      'name', con.conname,
      'type', con.contype,
      'definition', pg_get_constraintdef(con.oid, true),
      'deferrable', con.condeferrable,
      'initially_deferred', con.condeferred,
      'validated', con.convalidated,
      'no_inherit', con.connoinherit,
      'parent_constraint', case
        when con.conparentid <> 0 then con.conparentid::regclass::text
      end,
      'comment', obj_description(con.oid, 'pg_constraint')
    ) order by c.relname, con.conname), '[]'::jsonb)
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
  ),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'relation', t.relname,
      'name', i.relname,
      'definition', pg_get_indexdef(i.oid),
      'unique', x.indisunique,
      'primary', x.indisprimary,
      'exclusion', x.indisexclusion,
      'immediate', x.indimmediate,
      'clustered', x.indisclustered,
      'valid', x.indisvalid,
      'ready', x.indisready,
      'live', x.indislive,
      'nulls_not_distinct', x.indnullsnotdistinct,
      'predicate', pg_get_expr(x.indpred, x.indrelid),
      'comment', obj_description(i.oid, 'pg_class')
    ) order by t.relname, i.relname), '[]'::jsonb)
    from pg_index x
    join pg_class i on i.oid=x.indexrelid
    join pg_class t on t.oid=x.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public'
  ),
  'sequences', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'data_type', format_type(s.seqtypid, null),
      'start', s.seqstart,
      'increment', s.seqincrement,
      'min', s.seqmin,
      'max', s.seqmax,
      'cache', s.seqcache,
      'cycle', s.seqcycle,
      'owned_by', (
        select jsonb_build_object('relation', tc.relname, 'column', a.attname)
        from pg_depend d
        join pg_class tc on tc.oid=d.refobjid
        join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
        where d.classid='pg_class'::regclass
          and d.objid=c.oid and d.deptype in ('a','i')
        limit 1
      )
    ) order by c.relname), '[]'::jsonb)
    from pg_sequence s
    join pg_class c on c.oid=s.seqrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
  ),
  'views', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'kind', c.relkind,
      'definition', pg_get_viewdef(c.oid, true),
      'options', c.reloptions,
      'check_option', v.check_option,
      'is_updatable', v.is_updatable,
      'is_insertable_into', v.is_insertable_into,
      'security_barrier', position(
        'security_barrier=true' in array_to_string(c.reloptions, ',')
      ) > 0,
      'security_invoker', position(
        'security_invoker=true' in array_to_string(c.reloptions, ',')
      ) > 0
    ) order by c.relname), '[]'::jsonb)
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    left join information_schema.views v
      on v.table_schema=n.nspname and v.table_name=c.relname
    where n.nspname='public' and c.relkind in ('v','m')
  ),
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'kind', p.prokind,
      'language', l.lanname,
      'owner', pg_get_userbyid(p.proowner),
      'volatility', p.provolatile,
      'parallel', p.proparallel,
      'strict', p.proisstrict,
      'security_definer', p.prosecdef,
      'leakproof', p.proleakproof,
      'config', p.proconfig,
      'acl', coalesce(
        (select jsonb_agg(x::text order by x::text) from unnest(p.proacl) x),
        '[]'::jsonb
      ),
      'definition', pg_get_functiondef(p.oid),
      'comment', obj_description(p.oid, 'pg_proc')
    ) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prokind in ('f','p')
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'relation', c.relname,
      'name', t.tgname,
      'enabled', t.tgenabled,
      'is_internal', t.tgisinternal,
      'definition', pg_get_triggerdef(t.oid, true),
      'function', pn.nspname || '.' || p.proname,
      'comment', obj_description(t.oid, 'pg_trigger')
    ) order by c.relname, t.tgname), '[]'::jsonb)
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
    join pg_namespace pn on pn.oid=p.pronamespace
    where n.nspname='public' and not t.tgisinternal
  ),
  'policies', (
    select coalesce(
      jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname),
      '[]'::jsonb
    )
    from pg_policies p where p.schemaname='public'
  ),
  'relation_privileges', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'relation', c.relname,
      'kind', c.relkind,
      'grantor', pg_get_userbyid(a.grantor),
      'grantee', case
        when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)
      end,
      'privilege', a.privilege_type,
      'grantable', a.is_grantable
    ) order by c.relname,
      case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type), '[]'::jsonb)
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(coalesce(
      c.relacl,
      acldefault(
        case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,
        c.relowner
      )
    )) a
    where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
  ),
  'default_acl', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'owner', pg_get_userbyid(d.defaclrole),
      'schema', n.nspname,
      'object_type', d.defaclobjtype,
      'grantor', pg_get_userbyid(a.grantor),
      'grantee', case
        when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)
      end,
      'privilege', a.privilege_type,
      'grantable', a.is_grantable
    ) order by pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype,
      case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type), '[]'::jsonb)
    from pg_default_acl d
    left join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
  ),
  'event_triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', e.evtname,
      'event', e.evtevent,
      'owner', pg_get_userbyid(e.evtowner),
      'function', n.nspname || '.' || p.proname,
      'enabled', e.evtenabled,
      'tags', e.evttags
    ) order by e.evtname), '[]'::jsonb)
    from pg_event_trigger e
    join pg_proc p on p.oid=e.evtfoid
    join pg_namespace n on n.oid=p.pronamespace
  ),
  'rules', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'relation', c.relname,
      'name', r.rulename,
      'enabled', r.ev_enabled,
      'definition', pg_get_ruledef(r.oid, true)
    ) order by c.relname, r.rulename), '[]'::jsonb)
    from pg_rewrite r
    join pg_class c on c.oid=r.ev_class
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and r.rulename <> '_RETURN'
  ),
  'extended_statistics', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', e.stxname,
      'owner', pg_get_userbyid(e.stxowner),
      'definition', pg_get_statisticsobjdef(e.oid)
    ) order by e.stxname), '[]'::jsonb)
    from pg_statistic_ext e join pg_namespace n on n.oid=e.stxnamespace
    where n.nspname='public'
  ),
  'inheritance', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'child', child.relname,
      'parent', parent.relname,
      'sequence', i.inhseqno,
      'detach_pending', i.inhdetachpending
    ) order by child.relname, i.inhseqno), '[]'::jsonb)
    from pg_inherits i
    join pg_class child on child.oid=i.inhrelid
    join pg_namespace cn on cn.oid=child.relnamespace
    join pg_class parent on parent.oid=i.inhparent
    where cn.nspname='public'
  ),
  'publications', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.pubname,
      'owner', pg_get_userbyid(p.pubowner),
      'all_tables', p.puballtables,
      'insert', p.pubinsert,
      'update', p.pubupdate,
      'delete', p.pubdelete,
      'truncate', p.pubtruncate,
      'via_partition_root', p.pubviaroot,
      'tables', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'schema', pt.schemaname,
          'table', pt.tablename,
          'columns', pt.attnames,
          'row_filter', pt.rowfilter
        ) order by pt.schemaname, pt.tablename), '[]'::jsonb)
        from pg_publication_tables pt where pt.pubname=p.pubname
      )
    ) order by p.pubname), '[]'::jsonb)
    from pg_publication p
  )
) as capture;
