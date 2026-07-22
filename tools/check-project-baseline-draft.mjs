#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createReport } from './lib/report.mjs';
import { sha256 } from './lib/schema-dump-review.mjs';
import {
  BASELINE_PHASES,
  allZero,
  compareToSchemaDumpReview,
  parseBaselineObjects,
  phaseOrder,
  scanBaseline,
} from './lib/project-baseline-draft.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd());
const report = createReport('Project-baseline-draft');
const baselinePath = join(root, 'supabase/baseline/project-schema-baseline.draft.sql');
const inventoryPath = join(root, 'supabase/baseline/project-schema-baseline.draft.inventory.json');
const reviewPath = join(root, 'supabase/schema-dump-review.json');

function read(path, code) {
  if (!existsSync(path)) {
    report.blocker(code, 'Påkrævet fil mangler', relative(root, path));
    return null;
  }
  return readFileSync(path, 'utf8');
}

function parse(text, code) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    report.blocker(code, error.message);
    return null;
  }
}

const baseline = read(baselinePath, 'BASELINE_DRAFT_MISSING');
const inventoryText = read(inventoryPath, 'BASELINE_INVENTORY_MISSING');
const reviewText = read(reviewPath, 'BASELINE_SOURCE_REVIEW_MISSING');
const inventory = parse(inventoryText, 'BASELINE_INVENTORY_JSON');
const review = parse(reviewText, 'BASELINE_SOURCE_REVIEW_JSON');

if (baseline && inventory && review) {
  const objects = parseBaselineObjects(baseline);
  const comparison = compareToSchemaDumpReview(objects, review);
  const scan = scanBaseline(baseline);
  const inventoryScan = scanBaseline(inventoryText);
  const order = phaseOrder(baseline);

  if (inventory.format_version !== 1 || inventory.status !== 'draft_not_replayed') {
    report.blocker('BASELINE_STATUS', 'Baseline skal være version 1 og draft_not_replayed');
  }
  if (inventory.source_gate_commit !== '14c53540d0d465745e41670b84a5462178fb9205') {
    report.blocker('BASELINE_SOURCE_COMMIT', 'Forkert source-gate commit');
  }
  if (inventory.provenance?.database_connections !== 0 || inventory.provenance?.database_writes !== false) {
    report.blocker('BASELINE_DATABASE_ACTIVITY', 'Draften skal være bygget uden databaseforbindelse eller writes');
  }
  if (inventory.provenance?.replay_performed !== false || inventory.provenance?.migration_history_changed !== false) {
    report.blocker('BASELINE_REPLAY_CLAIM', 'Draften må ikke påstå replay eller historikændring');
  }
  if (inventory.provenance?.source_review_sha256 !== sha256(reviewText)) {
    report.blocker('BASELINE_SOURCE_REVIEW_HASH', 'Source-review SHA-256 matcher ikke');
  }
  if (inventory.provenance?.private_source_dump_sha256 !== review.private_artifacts?.dump?.sha256) {
    report.blocker('BASELINE_SOURCE_DUMP_HASH', 'Privat source-dump SHA-256 matcher ikke reviewmetadata');
  }
  if (inventory.provenance?.raw_dump_committed !== false) {
    report.blocker('BASELINE_RAW_DUMP_CLAIM', 'Rå dump må ikke være committet');
  }
  if (inventory.draft?.sha256 !== sha256(baseline) || inventory.draft?.deterministic !== true) {
    report.blocker('BASELINE_DRAFT_HASH', 'Baselinehash/determinisme matcher ikke inventory');
  }
  if (inventory.draft?.migration !== false || inventory.draft?.replay_authorized !== false) {
    report.blocker('BASELINE_DRAFT_GATE', 'Draften må ikke være migration eller replay-autoriseret');
  }

  for (const phrase of [
    'DRAFT ONLY / DO NOT REPLAY',
    'STOP BOUNDARY',
    'not authorized for db push',
    'SECURITY DEFINER',
  ]) {
    if (!baseline.includes(phrase)) report.blocker('BASELINE_HEADER', `Sanitiseret header mangler: ${phrase}`);
  }
  if (/\/Users\/|private-captures|\.pgpass/i.test(baseline) || /\/Users\/|private-captures|\.pgpass/i.test(inventoryText)) {
    report.blocker('BASELINE_PRIVATE_PATH', 'Baseline eller inventory indeholder privat path');
  }
  if (!allZero(inventoryScan.credentials) || inventoryScan.platform.connection_references !== 0 || inventoryScan.platform.project_ref_candidates !== 0) {
    report.blocker('BASELINE_INVENTORY_SECRET', 'Inventory indeholder credential eller miljøspecifik connectionreference');
  }

  if (!allZero(scan.data)) report.blocker('BASELINE_DATA', 'Baseline indeholder tabeldata eller historisk DML');
  if (!allZero(scan.credentials)) report.blocker('BASELINE_CREDENTIAL', 'Baseline indeholder muligt credential');
  if (!allZero(scan.privileges)) report.blocker('BASELINE_PRIVILEGE', 'Baseline indeholder owner/grant/revoke/role-DDL');
  const { moddatetime_references: moddatetime, ...blockedPlatform } = scan.platform;
  if (!allZero(blockedPlatform)) report.blocker('BASELINE_PLATFORM', 'Baseline indeholder intern, extension-, migrations- eller connection-DDL/reference');
  if (moddatetime !== 3) report.blocker('BASELINE_MODDATETIME', 'Baseline skal have præcis tre eksterne moddatetime-referencer');
  if (scan.security_definer_functions !== 1) report.blocker('BASELINE_SECURITY_DEFINER', 'Baseline skal bevare præcis én reviewblokeret SECURITY DEFINER-funktion');
  if (!/CREATE VIEW public\.investor_status WITH \(security_invoker='true'\)/.test(baseline)) {
    report.blocker('BASELINE_VIEW_SECURITY', 'investor_status skal være security_invoker');
  }
  if (!/CREATE FUNCTION public\.rls_auto_enable\(\) RETURNS event_trigger[\s\S]*SET search_path TO 'pg_catalog'/.test(baseline)) {
    report.blocker('BASELINE_FUNCTION_SECURITY', 'rls_auto_enable skal bevare fast pg_catalog search_path');
  }

  if (!comparison.all_match) report.blocker('BASELINE_OBJECT_DIFF', 'Baselineobjekterne matcher ikke schema-dump-review.json');
  for (const [name, result] of Object.entries(comparison.comparisons)) {
    if (!result.match) report.blocker('BASELINE_OBJECT_DIFF', `${name}: mangler=${result.missing.join(',')} ekstra=${result.extra.join(',')}`);
  }
  if (JSON.stringify(inventory.object_inventory) !== JSON.stringify(objects)) {
    report.blocker('BASELINE_INVENTORY_OBJECTS', 'Commited inventory matcher ikke SQL-filen');
  }
  const recomputedCounts = Object.fromEntries(Object.entries(objects).map(([key, values]) => [key, values.length]));
  if (JSON.stringify(inventory.object_counts) !== JSON.stringify(recomputedCounts)) {
    report.blocker('BASELINE_INVENTORY_COUNTS', 'Objekttal matcher ikke SQL-filen');
  }
  if (inventory.source_review_comparison?.all_match !== true) {
    report.blocker('BASELINE_INVENTORY_DIFF', 'Inventory skal dokumentere fuld source-review-paritet');
  }
  if (JSON.stringify(inventory.exclusions?.scan) !== JSON.stringify(scan)) {
    report.blocker('BASELINE_SCAN_INVENTORY', 'Commited sikkerhedsscan matcher ikke SQL-filen');
  }

  let previous = -1;
  for (const [index, phase] of order.entries()) {
    if (phase.index < 0 || phase.index <= previous) report.blocker('BASELINE_PHASE_ORDER', `Forkert faseorden: ${phase.id}`);
    previous = phase.index;
    const expected = BASELINE_PHASES[index];
    if (phase.object_count !== expected.objects.length) report.blocker('BASELINE_PHASE_COUNT', `Forkert objektantal i ${phase.id}`);
    if (baseline.split(`-- phase: ${phase.id}`).length - 1 !== 1) report.blocker('BASELINE_PHASE_DUPLICATE', `Fasen ${phase.id} skal forekomme én gang`);
  }
  if (JSON.stringify(inventory.dependency_order) !== JSON.stringify(BASELINE_PHASES.map(phase => ({ phase: phase.id, label: phase.label, object_count: phase.objects.length })))) {
    report.blocker('BASELINE_DEPENDENCY_INVENTORY', 'Dependency-order matcher ikke den kanoniske generatororden');
  }

  if (inventory.risk_gate?.security_definer_function_preserved !== true || inventory.risk_gate?.event_trigger_excluded !== true || inventory.risk_gate?.executable_acl_excluded !== true) {
    report.blocker('BASELINE_RISK_GATE', 'Sikkerhedsrisici er ikke eksplicit bevaret');
  }
  if (inventory.risk_gate?.local_replay_required_before_promotion !== true || inventory.risk_gate?.baseline_sql_promotion_authorized !== false || inventory.risk_gate?.remote_history_alignment_authorized !== false) {
    report.blocker('BASELINE_PROMOTION_GATE', 'Lokal replay-gate og remote stopgrænse mangler');
  }
}

report.finish();
