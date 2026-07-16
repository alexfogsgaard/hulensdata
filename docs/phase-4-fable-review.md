# Fase 4 — Fable-review af planlægningen

> Uafhængigt arkitektur- og redaktionelt review, 2026-07-16. Reviewet dækker `docs/phase-4-implementation-plan.md`, `docs/phase-4-data-contracts.md` og `docs/phase-4-risk-register.md` på planlægningscommit `0f17ee5` (baseline `main` = `9ba919f`). Planens faktapåstande er efterprøvet mod koden, vaulten og livekataloget — ikke taget for givet.

## Samlet vurdering

Planen er usædvanligt ærlig og bygger på en korrekt kortlægning af det eksisterende system. Alle centrale faktapåstande holdt ved uafhængig kontrol:

- `tools/backup.sh` (vaulten) opfører sig præcis som beskrevet: sekventiel anon-REST med `limit=10000`, skriver direkte i datomappen, sanity-checker kun `deals > 300`.
- Livekataloget har 16 migrationer med head `20260714212928_allow_unknown_episode` — manifestets `migration_head`-format matcher virkeligheden.
- `anon`/`authenticated` har i dag **fulde tabelprivilegier** (SELECT/INSERT/UPDATE/DELETE/TRUNCATE m.fl.) på alle ni objekter; kun SELECT-only RLS-policies forhindrer skrivning. R11/R12 er altså ikke teoretiske.
- `fetchAllPages()`/`createReport()` findes med de navne og kontrakter, planen genbruger; snapshottet består af `trykt` + ni arrays; `validate-data.mjs` dækker de regler, planen vil genbruge.

Systemgrænserne er rigtigt tænkt: Supabase forbliver eneste redigerbare sandhed, alle nye artefakter er forslag/afledning/dokumentation, og apply er eksplicit udskudt. Kontrakterne havde fem reelle fejl (rettet i dette review, se nedenfor), og to nye risici er føjet til registret. Med disse rettelser er planen implementerbar i det eksisterende repo uden credentials og uden at svække fase 3-kontrakterne.

## Blockers fundet i planen (nu rettet i plandokumenterne)

1. **Insert-targets var umulige.** `target.record_id` var required integer ≥ 1, samtidig med at reglen forbød at opfinde id'er. Dermed kunne "event oprettet med ny source" og "source oprettet og brugt i samme batch" ikke udtrykkes. Rettet: `record_id: null` + `local_ref` (`new:<navn>`) for inserts; andre operationer kan referere batch-lokale rækker via `local_ref`.
2. **`supports` kunne ikke udtrykke helhedskilder.** DB'ens `sources.field_name` er én nullable kolonne, og de fleste af de 61 eksisterende kilder dækker hele entiteten. Kontrakten krævede `minItems: 1`. Rettet: `supports: []` = hele entiteten (`field_name = NULL`); ikke-tomt array = én source-række pr. felt.
3. **Precondition-semantikken var tvetydig.** "`expected_before` skal matche baseline" er uforeneligt med to ændringer af samme felt i samme batch. Rettet: samme (entitet, felt) må højst ændres af én operation pr. batch (`OPERATION_CONFLICT`); preconditions evalueres altid mod baselinen.
4. **Slugændringer manglede redirect-model.** AI-WORKFLOW kræver, at gamle URL'er virker, og runde 7 beviste behovet i praksis (`_redirects`). Rettet: `set` på en slug kræver `redirect_from`, og dry-run skal udskrive den `_redirects`-linje, der hører til gentrykket.
5. **Coverage blandede genereret og manuelt.** Schemaet havde `workflow_status`/`resolved_by_revision` i generatoroutputtet, mens prosaen sagde overlay. Rettet: generatorfilen er ren; manuel status bor i `coverage-overlay.json` knyttet til `item_id`; merge er deterministisk.

## Øvrige kontraktændringer foretaget

- Inbox-status `applied` fjernet fra 1.0.0 (apply findes ikke i 4A; anvendthed dokumenteres af ledgeren). Genindføres tidligst sammen med et obligatorisk `applied_revision`-felt.
- Revisionsloggen anbefales som **NDJSON** (én entry pr. linje): naturlig append-only, triviel byte-præfiks-verifikation, ingen git-mergekonflikter i et fælles array. `supersedes`-felt kobler rettelser til tidligere revisioner.
- Backupmanifest: `project_ref`-pattern rettet til `^[a-z0-9]{20}$` (refs kan indeholde cifre); nye felter `environment`, `tool`+`version`, `consistency` (den nuværende eksport er ærligt `sequential_per_table`) og valgfrit `published_snapshot_sha256`.
- Sammenligningssemantik gjort eksplicit: dyb strukturel lighed uden typekoercion; snapshottet serialiserer numerics som JSON-tal.
- Actor-id'er skal være aftalte pseudonymer (`alexander`, `codex`, `fable`, `system`) — aldrig e-mail/persondata.
- Validatorer skal aktivt secret-scanne artefakter (`eyJ`, `apikey`, `authorization`, `service_role`).

## Anbefalet systemgrænse (bekræftet + skærpet)

- Supabase = eneste redigerbare produktionssandhed. `data/arkiv.json` = genereret publiceringssnapshot. `editorial/inbox` = kandidatdata. Coverage = afledning af snapshot + regler. Ledger = workflow-dokumentation, ikke databasehistorik. Manifest = integritetsbeskrivelse af en eksport, ikke selve backuppen.
- **Trykpressen må aldrig læse editorial-artefakter** — håndhæv med en guard-test (grep/import-analyse), ikke kun konvention.
- **Dry-run har netværksforbud og skriveforbud:** ingen Supabase-import, ingen `SUPABASE_URL`; guard-test beviser nul netværkskald og uændrede inputfiler (hash før/efter). REST-fallback kan dermed ikke aktiveres utilsigtet.
- **Verify-gaten er afgrænset:** `npm run verify` (= Netlify-deploy-gaten) validerer kun schemas + committede fixtures. Levende inbox/ledger valideres af separat `verify:editorial` (ny risiko R29).

## Anbefalet prioriteringsmatrix (coverage-backlog)

| Prioritet | Indhold | Eksempler fra det aktuelle datasæt | Blokerer deploy? |
|---|---|---|---|
| critical | Identitetskonflikter under afklaring (`identity_review`/`ambiguous`) — aldrig automatiske negative slutninger | Lady box (161) ↔ Ladybox ApS (162) mulig dublet/comeback; Sorelle (270) ↔ "Slut Smyk ApS" | Nej |
| high | Manglende CVR på virksomheder **med gennemført TV-aftale**; `inaktiv` status uden kurateret event (registerfakta-listen); åbne leads med CVR-dateret exit-kandidat | That's Mine, Bubbles, Vinhuset; de 14 registerfakta-selskaber | Nej |
| medium | Manglende kategori; K12-arv (ukendt afsnit/søgt beløb); company-status uden kilde | 242 virksomheder uden kategori | Nej |
| low | Intet dokumenteret efterliv (ren researchopgave; fravær er `unknown`) | 308 virksomheder uden events | Nej |

Regler: (1) **Backloggen blokerer aldrig deploy** — kun `validate-data`-blockers gør, og hvad verify allerede blokerer (fx event uden kilde, konkurs-event mod aktiv status), må ikke duplikeres som backlogposter. (2) Manglende CVR og manglende efterliv må aldrig blokere. (3) "Gammel/utilgængelig kilde" vurderes ikke af generatoren (ingen netværkstjek — determinisme); et separat, valgfrit online-værktøj kan senere producere *forslag* til overlayet. (4) `item_id` = regel + database-id, så posten overlever navne-/slugrettelser. (5) Poster lukkes af dataændringer (posten forsvinder ved regenerering) eller af en eksplicit overlay-afgørelse — aldrig ved at redigere generatoroutput.

## Anbefalet revisionsmodel (mindst komplekse troværdige)

Append-only **NDJSON**-ledger med statusflow `proposed → validated → approved → (applied → published i 4B)`. Kun mennesker (Alexander) må sætte `approved`; `applied` kan først opstå, når et apply-trin findes, og kræver approver, after-hash og backup-id; `published` er **ikke et felt** men udledes af det efterfølgende gentryk (git-SHA + snapshottets `trykt`-dato). Ude-af-sync opdages ved at afstemme ledgerens after-hashes mod det aktuelle snapshot — advarsel, ikke blocker. Loggen dokumenterer workflow; den påstår aldrig at være databasehistorik (`updated_at`/read-back er databasens evidens). Persondata undgås med pseudonym-reglen. Stærkere garantier (hash-kæde, signerede commits, DB-audit) udskydes, til et flerbrugerbehov faktisk findes — R25's princip om ikke at påstå mere, end evidensen bærer, fastholdes.

## Anbefalet backupmodel

Behold den ærlige skelnen: git-historik (kode+dokumenter) ≠ Netlify-rollback (publicering) ≠ `arkiv.json` (publiceret data-øjebliksbillede) ≠ JSON-dataeksport (indhold) ≠ fuld databasebackup (DDL, functions, triggers, policies, grants, sequences) ≠ restore rehearsal (bevis). 4A leverer manifest + verifikation af eksisterende eksporter og evt. en ny Range-pagineret eksport med tempmappe og atomisk `complete`; `backup.sh` bevares indtil bevist paritet. Manifestet erklærer nu eksplicit `environment`, værktøj+version og konsistensniveau, og et manifest uden schema-/policy-/grant-artefakter må aldrig omtales som fuld backup. **Planen lover ikke rollback, den ikke kan udføre** — det er korrekt, og restore rehearsal forbliver en 4B-forudsætning for apply.

## Sikkerhedskrav (4A)

1. Ingen credentials i repo, fixtures, logs, diffs eller manifest-`query`; fixtures bruger fiktiv `project_ref`; aktiv secret-scanning i validatorerne.
2. Ingen service-role i 4A overhovedet; frisk eksport bruger højst den offentlige anon-nøgle (read-only via RLS — men husk R11: grants er brede, så anon-nøglen skal fortsat behandles som læseadgang, ikke som "ufarlig").
3. Input-hærdning: byte-/dybde-/antalsgrænser, `additionalProperties: false`, `__proto__`/prototype-pollution-mutation, path-mønstret i `relative_path` + `lstat`-symlink-afvisning, ingen shell-interpolation af filindhold.
4. Ingen ukontrolleret URL-fetching i 4A-værktøjer (SSRF-fladen er nul, når netværksforbuddet håndhæves).
5. Persondataminimering: pseudonym-actors; private reviewnoter må aldrig kunne flyde ind i publicerbare felter (apply-allowlist i 4B, fixture med intern note).
6. CSV-/regnearkseksport findes ikke i 4A; hvis det tilføjes senere, kræves formel-injection-værn (`=`,`+`,`-`,`@`-præfiks).

## Implementeringsrækkefølge (revideret, afstemt med risikoregistret)

4A: (1) schemas + fixtures → (2) filvalidator → (3) snapshot-dry-run → (4) backupmanifest-verifikation af eksisterende eksport (+ evt. ny eksport, gammel sti bevares) → (5) coverage-generator + overlay → (6) NDJSON-ledger → (7) mutation guards → (8) vault-dokumentation. Hvert commit er selvstændigt, holder `npm run verify` grønt, kan revertes og har fixtures tæt på implementeringen.

**Udskudt til 4B/fase 5 (må ikke implementeres i 4A):** Supabase writes af enhver art; service-role/credential-design; database-apply og apply-plan-generatoren (også den SQL-frie); DDL, RLS- eller grant-ændringer; produktionsrestore/restore rehearsal-miljø; automatisk publicering/build hooks; enhver mutation af `data/arkiv.json` eller Trykpressens output; database-auditspor; migrations-eksport til versionskontrol (afventer R20-beslutning).

## Kontrolpunkter til Codex (før 4A-review afsluttes)

1. Guard-testen for netværks- og skriveforbud findes og fejler, hvis nogen editorial-fil importerer `js/supabase.js`/bruger `fetch` mod eksterne værter.
2. En bevidst ugyldig inbox-fil uden for fixtures ændrer ikke `npm run verify`-exitcode (R29-testen).
3. `local_ref`-kæden testes: event-insert + source til samme event i ét batch; ukendt `local_ref` giver stabil fejlkode.
4. Same-field-konflikt, stale `expected_before`, slugændring uden `redirect_from` og genbrugt `operation_id` har hver sin mutation.
5. Coverage-generatoren producerer byte-identisk output ved to kørsler på samme snapshot (determinisme-test), og overlay-merge er deterministisk.
6. Ledger-prefix-verifikationen afviser omskrevne linjer, og `applied` uden approver/backup-id afvises.
7. Manifest-verifikation afviser: manglende tabel, manglende view, hash-mismatch, `complete` før alle artefakter, `rows` ≠ `content_range_total`.
8. Ingen fixture indeholder den rigtige `project_ref`, rigtige URL'er med nøgler eller andre secrets.

## Åbne beslutninger til Alexander

1. **Placering af editorial-artefakter (R30):** offentligt repo (nem CI, men offentlig research + deploy-nærhed) eller privat placering (vault/privat repo) med kun fixtures i kode-repoet. Anbefaling: privat placering; beslut før commit 2.
2. **Restore rehearsal-miljø (R21):** isoleret Supabase-projekt eller branch = omkostning/opsætning; forudsætning for ethvert 4B-apply.
3. **Backup-retention og offline-kopi (R17):** iCloud er synk, ikke uafhængig retention; beslut om en periodisk immutable kopi.
4. **Om 4B-apply overhovedet skal bygges** eller om manuel MCP/SQL + 4A-artefakterne er tilstrækkeligt i praksis (planen holder selv døren åben — enig).
5. **Migrationskilde (R20):** eksport af de 16 live-migrationer til versionsstyring, og hvor de skal bo (repo vs. vault).
6. **Redaktionelle afklaringer, der bør være de første coverage-cases:** Lady box/Ladybox-dubletten og Sorelle↔Slut Smyk ApS.

## Konklusion

Med de fem kontraktrettelser, de to nye risici (R29–R30) og den reviderede commitrækkefølge er planen sikker, sammenhængende og implementerbar i 4A-omfanget uden credentials. De åbne punkter er reelle beslutninger, ikke huller i planen — men punkt 1 (placering) bør afgøres, før implementeringen når commit 2.
