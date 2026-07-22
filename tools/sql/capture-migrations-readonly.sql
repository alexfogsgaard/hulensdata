select jsonb_build_object(
  'capture_version', 1,
  'captured_at', clock_timestamp(),
  'project_ref', 'upaxzfytumsijnbhjihd',
  'database_name', current_database(),
  'server_version', current_setting('server_version'),
  'method', 'Supabase MCP execute_sql; single SELECT from supabase_migrations.schema_migrations',
  'migrations', (
    select jsonb_agg(jsonb_build_object(
      'version', version,
      'name', name,
      'statements', statements,
      'rollback', rollback,
      'created_by', created_by,
      'idempotency_key', idempotency_key
    ) order by version)
    from supabase_migrations.schema_migrations
  )
) as capture;
