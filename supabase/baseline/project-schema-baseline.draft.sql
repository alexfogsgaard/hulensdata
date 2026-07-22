-- =============================================================================
-- HULENSDATA PROJECT SCHEMA BASELINE — DRAFT ONLY / DO NOT REPLAY
-- =============================================================================
-- Deterministically derived from the verified private PostgreSQL 17 schema dump.
-- Sanitized review: supabase/schema-dump-review.json
-- Sanitized review SHA-256: e7286c2675b24dd29687cffda55b9ae38fa37ed5eeb27805d7fcb8566a201352
-- Private source dump SHA-256: b2b592e5e512878bd6c7f2e0dee5fa9b0b861c3d5749dcee8a4600c8e2bd059e
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
-- =============================================================================

-- phase: 01_function
-- Project function

-- object: FUNCTION public.rls_auto_enable()
CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

-- phase: 02_tables_and_sequences
-- Tables and sequence/default wiring

-- object: TABLE public.companies
CREATE TABLE public.companies (
    id bigint NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    category text,
    status text DEFAULT 'ukendt'::text NOT NULL,
    cvr_nummer text,
    website text,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT companies_category_taxonomy CHECK (((category IS NULL) OR (category = ANY (ARRAY['Mad & drikke'::text, 'Tøj & accessories'::text, 'Teknologi & apps'::text, 'Design & bolig'::text, 'Service'::text, 'Børn & familie'::text, 'Oplevelser & underholdning'::text, 'Sundhed & livsstil'::text])))),
    CONSTRAINT companies_status_check CHECK ((status = ANY (ARRAY['aktiv'::text, 'inaktiv'::text, 'ukendt'::text])))
);

-- object: SEQUENCE public.companies_id_seq
ALTER TABLE public.companies ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.companies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- object: TABLE public.investors
CREATE TABLE public.investors (
    id bigint NOT NULL,
    canonical_name text NOT NULL,
    slug text NOT NULL,
    initials text NOT NULL,
    bio text,
    short_bio text,
    proff_url text,
    website_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- object: SEQUENCE public.investors_id_seq
ALTER TABLE public.investors ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.investors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- object: TABLE public.seasons
CREATE TABLE public.seasons (
    season_number integer NOT NULL,
    year integer NOT NULL,
    note text
);

-- object: TABLE public.deals
CREATE TABLE public.deals (
    id integer NOT NULL,
    saeson integer NOT NULL,
    afsnit integer,
    soeger numeric,
    andel_tilbudt numeric,
    beloeb_modtaget numeric,
    andel_solgt numeric,
    aftale boolean GENERATED ALWAYS AS ((beloeb_modtaget IS NOT NULL)) STORED,
    company_id bigint NOT NULL
);

-- object: SEQUENCE public.deals_id_seq
CREATE SEQUENCE public.deals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- object: SEQUENCE OWNED BY public.deals_id_seq
ALTER SEQUENCE public.deals_id_seq OWNED BY public.deals.id;

-- object: DEFAULT public.deals id
ALTER TABLE ONLY public.deals ALTER COLUMN id SET DEFAULT nextval('public.deals_id_seq'::regclass);

-- object: TABLE public.company_events
CREATE TABLE public.company_events (
    id bigint NOT NULL,
    company_id bigint NOT NULL,
    event_date date NOT NULL,
    date_precision text DEFAULT 'year'::text NOT NULL,
    event_type text NOT NULL,
    title text NOT NULL,
    description text,
    amount numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_events_date_precision_check CHECK ((date_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text]))),
    CONSTRAINT company_events_event_type_check CHECK ((event_type = ANY (ARRAY['renegotiated'::text, 'cancelled'::text, 'follow_on_investment'::text, 'exit'::text, 'bankruptcy'::text, 'closed'::text, 'comeback'::text, 'rebrand'::text, 'funding_round'::text, 'milestone'::text, 'other'::text])))
);

-- object: SEQUENCE public.company_events_id_seq
ALTER TABLE public.company_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.company_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- object: TABLE public.panel_memberships
CREATE TABLE public.panel_memberships (
    season_number integer NOT NULL,
    investor_id bigint NOT NULL,
    role text NOT NULL,
    CONSTRAINT panel_memberships_role_check CHECK ((role = ANY (ARRAY['fast'::text, 'gaest'::text])))
);

-- object: TABLE public.deal_investors
CREATE TABLE public.deal_investors (
    deal_id bigint NOT NULL,
    investor_id bigint NOT NULL,
    amount bigint,
    equity numeric(5,2)
);

-- object: TABLE public.sources
CREATE TABLE public.sources (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id bigint NOT NULL,
    field_name text,
    source_name text NOT NULL,
    source_url text,
    source_date date,
    note text,
    confidence text DEFAULT 'confirmed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sources_confidence_check CHECK ((confidence = ANY (ARRAY['confirmed'::text, 'likely'::text, 'uncertain'::text]))),
    CONSTRAINT sources_entity_type_check CHECK ((entity_type = ANY (ARRAY['deal'::text, 'company'::text, 'investor'::text, 'company_event'::text, 'season'::text]))),
    CONSTRAINT sources_url_scheme CHECK (((source_url IS NULL) OR (source_url ~* '^https?://'::text)))
);

-- object: SEQUENCE public.sources_id_seq
ALTER TABLE public.sources ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- phase: 03_primary_and_unique_constraints
-- Primary-key and unique constraints

-- object: CONSTRAINT public.companies companies_name_key
ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_name_key UNIQUE (name);

-- object: CONSTRAINT public.companies companies_pkey
ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);

-- object: CONSTRAINT public.companies companies_slug_key
ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_slug_key UNIQUE (slug);

-- object: CONSTRAINT public.investors investors_canonical_name_key
ALTER TABLE ONLY public.investors
    ADD CONSTRAINT investors_canonical_name_key UNIQUE (canonical_name);

-- object: CONSTRAINT public.investors investors_pkey
ALTER TABLE ONLY public.investors
    ADD CONSTRAINT investors_pkey PRIMARY KEY (id);

-- object: CONSTRAINT public.investors investors_slug_key
ALTER TABLE ONLY public.investors
    ADD CONSTRAINT investors_slug_key UNIQUE (slug);

-- object: CONSTRAINT public.seasons seasons_pkey
ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (season_number);

-- object: CONSTRAINT public.deals deals_pkey
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);

-- object: CONSTRAINT public.company_events company_events_pkey
ALTER TABLE ONLY public.company_events
    ADD CONSTRAINT company_events_pkey PRIMARY KEY (id);

-- object: CONSTRAINT public.panel_memberships panel_memberships_pkey
ALTER TABLE ONLY public.panel_memberships
    ADD CONSTRAINT panel_memberships_pkey PRIMARY KEY (season_number, investor_id);

-- object: CONSTRAINT public.deal_investors deal_investors_pkey
ALTER TABLE ONLY public.deal_investors
    ADD CONSTRAINT deal_investors_pkey PRIMARY KEY (deal_id, investor_id);

-- object: CONSTRAINT public.sources sources_pkey
ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);

-- phase: 04_foreign_keys
-- Foreign-key constraints

-- object: FK CONSTRAINT public.company_events company_events_company_id_fkey
ALTER TABLE ONLY public.company_events
    ADD CONSTRAINT company_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

-- object: FK CONSTRAINT public.deals deals_company_id_fkey
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);

-- object: FK CONSTRAINT public.panel_memberships panel_memberships_investor_id_fkey
ALTER TABLE ONLY public.panel_memberships
    ADD CONSTRAINT panel_memberships_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.investors(id);

-- object: FK CONSTRAINT public.panel_memberships panel_memberships_season_number_fkey
ALTER TABLE ONLY public.panel_memberships
    ADD CONSTRAINT panel_memberships_season_number_fkey FOREIGN KEY (season_number) REFERENCES public.seasons(season_number);

-- object: FK CONSTRAINT public.deal_investors deal_investors_deal_id_fkey
ALTER TABLE ONLY public.deal_investors
    ADD CONSTRAINT deal_investors_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id);

-- object: FK CONSTRAINT public.deal_investors deal_investors_investor_id_fkey
ALTER TABLE ONLY public.deal_investors
    ADD CONSTRAINT deal_investors_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.investors(id);

-- phase: 05_indexes
-- Standalone indexes

-- object: INDEX public.company_events_company_idx
CREATE INDEX company_events_company_idx ON public.company_events USING btree (company_id, event_date);

-- object: INDEX public.deal_investors_investor_id_idx
CREATE INDEX deal_investors_investor_id_idx ON public.deal_investors USING btree (investor_id);

-- object: INDEX public.deals_company_id_idx
CREATE INDEX deals_company_id_idx ON public.deals USING btree (company_id);

-- object: INDEX public.idx_deals_aftale
CREATE INDEX idx_deals_aftale ON public.deals USING btree (aftale);

-- object: INDEX public.idx_deals_saeson
CREATE INDEX idx_deals_saeson ON public.deals USING btree (saeson);

-- object: INDEX public.panel_memberships_investor_id_idx
CREATE INDEX panel_memberships_investor_id_idx ON public.panel_memberships USING btree (investor_id);

-- object: INDEX public.sources_entity_idx
CREATE INDEX sources_entity_idx ON public.sources USING btree (entity_type, entity_id);

-- phase: 06_view
-- Security-invoker view

-- object: VIEW public.investor_status
CREATE VIEW public.investor_status WITH (security_invoker='true') AS
 SELECT id,
    canonical_name,
    slug,
    (EXISTS ( SELECT 1
           FROM public.panel_memberships pm
          WHERE ((pm.investor_id = i.id) AND (pm.role = 'fast'::text) AND (pm.season_number = ( SELECT max(seasons.season_number) AS max
                   FROM public.seasons))))) AS is_active,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM public.panel_memberships pm
              WHERE ((pm.investor_id = i.id) AND (pm.role = 'fast'::text) AND (pm.season_number = ( SELECT max(seasons.season_number) AS max
                       FROM public.seasons))))) THEN 'aktiv'::text
            WHEN (NOT (EXISTS ( SELECT 1
               FROM public.panel_memberships pm
              WHERE ((pm.investor_id = i.id) AND (pm.role = 'fast'::text))))) THEN 'gaest'::text
            ELSE 'tidligere'::text
        END AS status,
    ( SELECT min(pm.season_number) AS min
           FROM public.panel_memberships pm
          WHERE (pm.investor_id = i.id)) AS first_season,
    ( SELECT max(pm.season_number) AS max
           FROM public.panel_memberships pm
          WHERE (pm.investor_id = i.id)) AS last_season,
    ( SELECT array_agg(pm.season_number ORDER BY pm.season_number) AS array_agg
           FROM public.panel_memberships pm
          WHERE (pm.investor_id = i.id)) AS panel_seasons
   FROM public.investors i;

-- phase: 07_triggers
-- Updated-at triggers

-- object: TRIGGER public.companies set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- object: TRIGGER public.company_events set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.company_events FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- object: TRIGGER public.investors set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.investors FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- phase: 08_row_security
-- RLS enablement

-- object: ROW SECURITY public.companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- object: ROW SECURITY public.company_events
ALTER TABLE public.company_events ENABLE ROW LEVEL SECURITY;

-- object: ROW SECURITY public.deal_investors
ALTER TABLE public.deal_investors ENABLE ROW LEVEL SECURITY;

-- object: ROW SECURITY public.deals
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

-- object: ROW SECURITY public.investors
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

-- object: ROW SECURITY public.panel_memberships
ALTER TABLE public.panel_memberships ENABLE ROW LEVEL SECURITY;

-- object: ROW SECURITY public.seasons
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

-- object: ROW SECURITY public.sources
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

-- phase: 09_policies
-- Read policies

-- object: POLICY public.companies anon_read
CREATE POLICY anon_read ON public.companies FOR SELECT USING (true);

-- object: POLICY public.company_events anon_read
CREATE POLICY anon_read ON public.company_events FOR SELECT USING (true);

-- object: POLICY public.deal_investors anon_read
CREATE POLICY anon_read ON public.deal_investors FOR SELECT USING (true);

-- object: POLICY public.deals Public read access
CREATE POLICY "Public read access" ON public.deals FOR SELECT TO anon USING (true);

-- object: POLICY public.investors anon_read
CREATE POLICY anon_read ON public.investors FOR SELECT USING (true);

-- object: POLICY public.panel_memberships anon_read
CREATE POLICY anon_read ON public.panel_memberships FOR SELECT USING (true);

-- object: POLICY public.seasons anon_read
CREATE POLICY anon_read ON public.seasons FOR SELECT USING (true);

-- object: POLICY public.sources anon_read
CREATE POLICY anon_read ON public.sources FOR SELECT USING (true);
