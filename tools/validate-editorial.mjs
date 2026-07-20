#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateOperationalPath, EditorialError, readJsonFile, readNdjsonFile, readTextFile } from './lib/editorial-files.mjs';
import { validateCoverage, validateInbox, validateManifestShape, validateOverlay, validateRevisionEntries } from './lib/editorial-contracts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const type = option('--type');
  const file = option('--file');
  if (!type || !file) throw new EditorialError('CLI_USAGE', 'Brug --type inbox|ledger|coverage|overlay|manifest --file <sti>');
  assertPrivateOperationalPath(file, ROOT);
  let count = 1;
  if (type === 'inbox') validateInbox(readJsonFile(file).value);
  else if (type === 'coverage') validateCoverage(readJsonFile(file).value);
  else if (type === 'overlay') validateOverlay(readJsonFile(file).value);
  else if (type === 'manifest') validateManifestShape(readJsonFile(file).value);
  else if (type === 'ledger') {
    const current = readNdjsonFile(file);
    validateRevisionEntries(current.values);
    count = current.values.length;
    const previousFile = option('--previous');
    if (previousFile) {
      assertPrivateOperationalPath(previousFile, ROOT);
      const previous = readTextFile(previousFile);
      if (!current.text.startsWith(previous.text)) throw new EditorialError('LEDGER_PREFIX', 'Ny ledger omskriver eksisterende bytes');
    }
  } else throw new EditorialError('CLI_TYPE', `Ukendt type: ${type}`);
  console.log(`Redaktionel validering: ${type} · ${count} elementer · 0 blockers`);
} catch (error) {
  const code = error.code || 'EDITORIAL_ERROR';
  console.error(`[BLOCKER] ${code}: ${error.message}${error.context ? ` (${error.context})` : ''}`);
  process.exitCode = 1;
}
