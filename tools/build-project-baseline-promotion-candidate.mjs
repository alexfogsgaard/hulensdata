#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPromotionCandidate, promotionInventory } from './lib/project-baseline-promotion.mjs';

const root = process.cwd();
const draftPath = join(root, 'supabase/baseline/project-schema-baseline.draft.sql');
const draftInventoryPath = join(root, 'supabase/baseline/project-schema-baseline.draft.inventory.json');
const reviewPath = join(root, 'supabase/schema-dump-review.json');
const candidatePath = join(root, 'supabase/baseline/project-schema-baseline.promotion-candidate.sql');
const inventoryPath = join(root, 'supabase/baseline/project-schema-baseline.promotion-candidate.inventory.json');

const draft = readFileSync(draftPath, 'utf8');
const draftInventory = readFileSync(draftInventoryPath, 'utf8');
const review = readFileSync(reviewPath, 'utf8');
const first = buildPromotionCandidate(draft, draftInventory);
const second = buildPromotionCandidate(draft, draftInventory);
if (first !== second) throw new Error('Promotion-generatoren er ikke deterministisk');
const inventory = promotionInventory(first, draft, draftInventory, review);
if (!inventory.expected_promotion_comparison.all_match) throw new Error('Promotion-inventory afviger fra den forventede project-only flade');

writeFileSync(candidatePath, first);
writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Promotion candidate genereret: ${inventory.candidate.sha256}`);
