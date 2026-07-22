-- =============================================================================
-- HULENSDATA PROJECT ACL CONTRACT — DRAFT / LOCAL REPLAY ONLY
-- =============================================================================
-- This contract is intentionally separate from the schema baseline. It has
-- been exercised only in isolated local PostgreSQL 17 clusters. It is not a
-- migration and is not authorized for production, db push, or history repair.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

REVOKE ALL ON TABLE
  public.companies,
  public.company_events,
  public.deal_investors,
  public.deals,
  public.investors,
  public.panel_memberships,
  public.seasons,
  public.sources,
  public.investor_status
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.companies,
  public.company_events,
  public.deal_investors,
  public.deals,
  public.investors,
  public.panel_memberships,
  public.seasons,
  public.sources,
  public.investor_status
TO anon, authenticated;

REVOKE ALL ON SEQUENCE
  public.companies_id_seq,
  public.company_events_id_seq,
  public.deals_id_seq,
  public.investors_id_seq,
  public.sources_id_seq
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
