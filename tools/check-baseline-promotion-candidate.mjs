#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createReport } from './lib/report.mjs';
import { allZero, parseBaselineObjects, scanBaseline } from './lib/project-baseline-draft.mjs';
import {
  PROMOTION_ACL_SQL,
  PROMOTION_PHASES,
  buildPromotionCandidate,
  compareToPromotionInventory,
  promotionInventory,
} from './lib/project-baseline-promotion.mjs';
import { sha256 } from './lib/schema-dump-review.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const report = createReport('Database-baseline-promotion-candidate');
const paths = {
  candidate: join(root, 'supabase/baseline/project-schema-baseline.promotion-candidate.sql'),
  inventory: join(root, 'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json'),
  draft: join(root, 'supabase/baseline/project-schema-baseline.draft.sql'),
  draftInventory: join(root, 'supabase/baseline/project-schema-baseline.draft.inventory.json'),
  review: join(root, 'supabase/schema-dump-review.json'),
};

function read(path, code) {
  if (!existsSync(path)) {
    report.blocker(code, 'Påkrævet fil mangler', relative(root, path));
    return null;
  }
  return readFileSync(path, 'utf8');
}

function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

const texts = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path, `PROMOTION_${key.toUpperCase()}_MISSING`)]));
if (Object.values(texts).every(value => value != null)) {
  let inventory;
  let review;
  let draftInventory;
  try {
    inventory = JSON.parse(texts.inventory);
    review = JSON.parse(texts.review);
    draftInventory = JSON.parse(texts.draftInventory);
  } catch (error) {
    report.blocker('PROMOTION_JSON', error.message);
  }

  if (inventory && review && draftInventory) {
    const expectedCandidate = buildPromotionCandidate(texts.draft, texts.draftInventory);
    const expectedInventory = promotionInventory(expectedCandidate, texts.draft, texts.draftInventory, texts.review);
    const objects = parseBaselineObjects(texts.candidate);
    const comparison = compareToPromotionInventory(objects, review);
    const scan = scanBaseline(texts.candidate);

    if (texts.candidate !== expectedCandidate) report.blocker('PROMOTION_DETERMINISM', 'Candidate afviger fra deterministisk generatoroutput');
    if (JSON.stringify(inventory) !== JSON.stringify(expectedInventory)) report.blocker('PROMOTION_INVENTORY', 'Inventory afviger fra deterministisk generatoroutput');
    if (inventory.status !== 'promotion_candidate_locally_replayed_not_applied' || inventory.candidate?.production_applied !== false) {
      report.blocker('PROMOTION_STATUS', 'Candidate skal være lokalt replayet, ikke anvendt på production');
    }
    if (inventory.candidate?.migration !== false || inventory.candidate?.remote_replay_authorized !== false || inventory.candidate?.migration_history_alignment_authorized !== false) {
      report.blocker('PROMOTION_STOP_BOUNDARY', 'Candidate må ikke være migration eller autorisere remote replay/historikafstemning');
    }
    if (sha256(texts.draft) !== 'cd3e13b826e278ced948d96fb75157834647dabeedb5654b20956bdbe2076e57' ||
        draftInventory.draft?.sha256 !== sha256(texts.draft)) {
      report.blocker('PROMOTION_DRAFT_IMMUTABLE', 'Den replayede draft er ændret');
    }
    if (inventory.candidate?.sha256 !== sha256(texts.candidate)) report.blocker('PROMOTION_HASH', 'Candidatehash matcher ikke SQL');
    if (!comparison.all_match) report.blocker('PROMOTION_OBJECT_DIFF', 'Candidate matcher ikke forventet promotion-inventory');
    if (objects.functions.length !== 0 || /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i.test(texts.candidate) || /rls_auto_enable/i.test(texts.candidate)) {
      report.blocker('PROMOTION_FUNCTION_REMOVAL', 'Candidate må ikke indeholde project-funktion eller rls_auto_enable');
    }
    if (scan.security_definer_functions !== 0) report.blocker('PROMOTION_SECURITY_DEFINER', 'Candidate må ikke indeholde SECURITY DEFINER DDL');
    if (!allZero(scan.data)) report.blocker('PROMOTION_DATA', 'Candidate indeholder tabeldata eller historisk DML');
    if (!allZero(scan.credentials)) report.blocker('PROMOTION_CREDENTIAL', 'Candidate indeholder credentialmønster');
    if (scan.privileges.owner_statements !== 0 || scan.privileges.create_role !== 0 || scan.privileges.alter_role !== 0) {
      report.blocker('PROMOTION_OWNER_ROLE', 'Candidate må ikke indeholde owners eller rolle-DDL');
    }
    const { moddatetime_references: moddatetime, ...blockedPlatform } = scan.platform;
    if (!allZero(blockedPlatform) || moddatetime !== 3) report.blocker('PROMOTION_PLATFORM', 'Candidate indeholder intern/miljøspecifik DDL eller forkert extension-reference');

    const aclMarker = '-- object: ACL public schema';
    const acl = texts.candidate.slice(texts.candidate.indexOf(aclMarker));
    if (acl !== `${PROMOTION_ACL_SQL}\n`) report.blocker('PROMOTION_ACL_EXACT', 'Integreret ACL afviger fra den kanoniske project-only kontrakt');
    if (scan.privileges.grant_statements !== 2 || scan.privileges.revoke_statements !== 3) {
      report.blocker('PROMOTION_ACL_STATEMENTS', 'ACL skal have præcis to grants og tre revokes');
    }
    if (!/ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/.test(texts.candidate)) {
      report.blocker('PROMOTION_PUBLIC_EXECUTE', 'Default PUBLIC EXECUTE på fremtidige project-funktioner er ikke fjernet');
    }
    if (/\bGRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i.test(texts.candidate) || /\bGRANT\s+(?:USAGE|SELECT|UPDATE|ALL)\s+ON\s+SEQUENCE/i.test(texts.candidate)) {
      report.blocker('PROMOTION_WRITE_GRANT', 'Candidate giver write- eller sequence-adgang');
    }
    if (/\b(?:service_role|supabase_admin|postgres|authenticator)\b/i.test(acl)) {
      report.blocker('PROMOTION_ROLE_SCOPE', 'ACL må kun omtale PUBLIC, anon og authenticated');
    }
    if (!/CREATE POLICY "Public read access" ON public\.deals FOR SELECT TO anon USING \(true\);/.test(texts.candidate)) {
      report.blocker('PROMOTION_DEALS_POLICY', 'Den åbne deals-beslutning skal bevare fanget anon-only adfærd');
    }
    if (inventory.security?.deals_policy?.decision_status !== 'open_product_decision_current_behavior_retained') {
      report.blocker('PROMOTION_DEALS_DECISION', 'Deals-asymmetrien skal være markeret som åben beslutning');
    }

    let previous = -1;
    for (const [id] of PROMOTION_PHASES) {
      const index = texts.candidate.indexOf(`-- phase: ${id}`);
      if (index < 0 || index <= previous) report.blocker('PROMOTION_PHASE_ORDER', `Manglende eller forkert fase: ${id}`);
      if (texts.candidate.split(`-- phase: ${id}`).length !== 2) report.blocker('PROMOTION_PHASE_DUPLICATE', `Fasen skal forekomme én gang: ${id}`);
      previous = index;
    }
    for (const phrase of ['PROMOTION CANDIDATE / NOT APPLIED', 'STOP BOUNDARY', 'not a migration', 'has not been applied to production']) {
      if (!texts.candidate.includes(phrase)) report.blocker('PROMOTION_HEADER', `Candidateheader mangler: ${phrase}`);
    }
    if (/\/Users\/|private-captures|\.pgpass|postgres(?:ql)?:\/\/|\.supabase\.(?:com|co)\b|sb_secret_/i.test(`${texts.candidate}\n${texts.inventory}`)) {
      report.blocker('PROMOTION_PRIVATE_MATERIAL', 'Candidate indeholder privat path, credential eller remote forbindelse');
    }
  }
}

const forbiddenArtifacts = walk(root).filter(path => statSync(path).isFile() && /(?:^|\/)(?:PG_VERSION|postmaster\.pid|postgres\.log|private-manifest\.json|promotion-schema\.raw\.sql)$/.test(path));
for (const path of forbiddenArtifacts) report.blocker('PROMOTION_ARTIFACT', 'Privat replayartefakt må ikke ligge i repository', relative(root, path));

report.finish();
