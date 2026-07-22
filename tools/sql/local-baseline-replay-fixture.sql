\set ON_ERROR_STOP on

-- Synthetic, local-only rows. The replay runner removes the complete cluster.
INSERT INTO public.seasons (season_number, year, note)
VALUES (1, 2026, 'local replay fixture');

INSERT INTO public.investors (id, canonical_name, slug, initials, created_at, updated_at)
OVERRIDING SYSTEM VALUE
VALUES (1, 'Fixture Investor', 'fixture-investor', 'FI', now(), '2000-01-01T00:00:00Z');

INSERT INTO public.companies (id, name, slug, category, status, created_at, updated_at)
OVERRIDING SYSTEM VALUE
VALUES (1, 'Fixture Company', 'fixture-company', NULL, 'ukendt', now(), '2000-01-01T00:00:00Z');

INSERT INTO public.deals
  (id, saeson, afsnit, soeger, andel_tilbudt, beloeb_modtaget, andel_solgt, company_id)
VALUES (1, 1, NULL, NULL, NULL, 100000, 10, 1);

INSERT INTO public.panel_memberships (season_number, investor_id, role)
VALUES (1, 1, 'fast');

INSERT INTO public.deal_investors (deal_id, investor_id, amount, equity)
VALUES (1, 1, 100000, 10);

INSERT INTO public.company_events
  (id, company_id, event_date, date_precision, event_type, title, created_at, updated_at)
OVERRIDING SYSTEM VALUE
VALUES (1, 1, '2026-01-01', 'year', 'milestone', 'Local fixture', now(), '2000-01-01T00:00:00Z');

INSERT INTO public.sources
  (id, entity_type, entity_id, source_name, confidence, created_at)
OVERRIDING SYSTEM VALUE
VALUES (1, 'company', 1, 'Local fixture', 'confirmed', now());

UPDATE public.companies SET description = 'trigger verification' WHERE id = 1;
UPDATE public.investors SET short_bio = 'trigger verification' WHERE id = 1;
UPDATE public.company_events SET description = 'trigger verification' WHERE id = 1;
