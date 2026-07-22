#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sha256 } from './lib/schema-dump-review.mjs';
import {
  BASELINE_PHASES,
  allZero,
  buildProjectBaselineDraft,
  compareToSchemaDumpReview,
  parseBaselineObjects,
  phaseOrder,
  scanBaseline,
} from './lib/project-baseline-draft.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`Manglende argument: ${name}`);
  return resolve(value);
}

function countObjects(objects) {
  return Object.fromEntries(Object.entries(objects).map(([key, values]) => [key, values.length]));
}

const dumpPath = arg('--dump');
const reviewPath = arg('--review');
const outputPath = arg('--output');
const inventoryPath = arg('--inventory');
const rawDump = readFileSync(dumpPath, 'utf8');
const reviewText = readFileSync(reviewPath, 'utf8');
const review = JSON.parse(reviewText);
const baseline = buildProjectBaselineDraft(rawDump, reviewText);
const secondBuild = buildProjectBaselineDraft(rawDump, reviewText);
if (baseline !== secondBuild) throw new Error('Baseline-output er ikke deterministisk');

const objects = parseBaselineObjects(baseline);
const comparison = compareToSchemaDumpReview(objects, review);
const scan = scanBaseline(baseline);
const order = phaseOrder(baseline);
const validOrder = order.every((phase, index) => phase.index >= 0 && (index === 0 || phase.index > order[index - 1].index));
if (!validOrder) throw new Error('Dependencyfaser mangler eller står i forkert rækkefølge');
for (const phase of BASELINE_PHASES) {
  const occurrences = baseline.split(`-- phase: ${phase.id}`).length - 1;
  if (occurrences !== 1) throw new Error(`Fasen ${phase.id} forekommer ${occurrences} gange`);
}
if (!comparison.all_match) throw new Error('Baselineinventaret matcher ikke schema-dump-review.json');
if (!allZero(scan.data)) throw new Error('Baseline indeholder data eller historisk DML');
if (!allZero(scan.credentials)) throw new Error('Baseline indeholder muligt credential');
if (!allZero(scan.privileges)) throw new Error('Baseline indeholder owner/grant/role-DDL');
const { moddatetime_references: moddatetime, ...blockedPlatform } = scan.platform;
if (!allZero(blockedPlatform)) throw new Error('Baseline indeholder intern eller miljøspecifik DDL/reference');
if (moddatetime !== 3) throw new Error(`Forventede 3 moddatetime-afhængigheder, fandt ${moddatetime}`);
if (scan.security_definer_functions !== 1) throw new Error('Forventede præcis én SECURITY DEFINER-funktion');

const inventory = {
  format_version: 1,
  status: 'draft_not_replayed',
  source_gate_commit: '14c53540d0d465745e41670b84a5462178fb9205',
  provenance: {
    method: 'deterministic local extraction from verified private schema-only dump',
    database_connections: 0,
    database_writes: false,
    replay_performed: false,
    migration_history_changed: false,
    source_review_file: 'supabase/schema-dump-review.json',
    source_review_sha256: sha256(reviewText),
    private_source_dump_sha256: review.private_artifacts.dump.sha256,
    raw_dump_committed: false,
  },
  draft: {
    file: 'supabase/baseline/project-schema-baseline.draft.sql',
    sha256: sha256(baseline),
    deterministic: true,
    migration: false,
    replay_authorized: false,
  },
  object_counts: countObjects(objects),
  object_inventory: objects,
  source_review_comparison: comparison,
  dependency_order: BASELINE_PHASES.map(phase => ({
    phase: phase.id,
    label: phase.label,
    object_count: phase.objects.length,
  })),
  exclusions: {
    scan,
    table_data: true,
    historical_dml: true,
    owners_grants_and_roles: true,
    credentials: true,
    supabase_internal_objects: true,
    extension_ddl: true,
    migration_history: true,
    connection_configuration: true,
  },
  external_dependencies: [
    'pre-existing public schema',
    'PostgreSQL 17-compatible runtime',
    'extensions.moddatetime(text)',
    'separately reviewed least-privilege ACL contract',
  ],
  risk_gate: {
    security_definer_function_preserved: true,
    event_trigger_excluded: true,
    executable_acl_excluded: true,
    local_replay_required_before_promotion: true,
    baseline_sql_promotion_authorized: false,
    remote_history_alignment_authorized: false,
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(inventoryPath), { recursive: true });
writeFileSync(outputPath, baseline);
writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Project-baseline draft: ${Object.values(inventory.object_counts).reduce((sum, value) => sum + value, 0)} inventoried objects · deterministic · not replayed`);
