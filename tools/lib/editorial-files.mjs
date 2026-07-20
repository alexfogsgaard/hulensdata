import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export class EditorialError extends Error {
  constructor(code, message, context = '') {
    super(message);
    this.name = 'EditorialError';
    this.code = code;
    this.context = context;
  }
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const SECRET_PATTERNS = [
  ['SECRET_JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['SECRET_APIKEY', /\bapikey\b\s*[:=]/i],
  ['SECRET_AUTHORIZATION', /\bauthorization\b\s*[:=]/i],
  ['SECRET_SERVICE_ROLE', /\bservice[_-]?role\b\s*[:=]/i],
];

export function scanSecrets(text, context = '') {
  for (const [code, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) throw new EditorialError(code, 'Artefaktet ligner en credential eller Authorization-header', context);
  }
}

function inspectValue(value, { depth = 0, maxDepth = 30, maxItems = 10000, counter = { value: 0 }, path = '$' } = {}) {
  if (depth > maxDepth) throw new EditorialError('JSON_DEPTH', `JSON overskrider maksimal dybde ${maxDepth}`, path);
  counter.value++;
  if (counter.value > maxItems) throw new EditorialError('JSON_ITEMS', `JSON overskrider maksimum ${maxItems} værdier`, path);
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new EditorialError('JSON_PROTOTYPE_KEY', `Reserveret objektnøgle: ${key}`, path);
    }
    inspectValue(value[key], { depth: depth + 1, maxDepth, maxItems, counter, path: `${path}.${key}` });
  }
}

export function readTextFile(file, { maxBytes = 1024 * 1024, secretScan = true } = {}) {
  const absolute = resolve(file);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) throw new EditorialError('FILE_SYMLINK', 'Symbolske links accepteres ikke som redaktionelt input', absolute);
  if (!info.isFile()) throw new EditorialError('FILE_TYPE', 'Input skal være en almindelig fil', absolute);
  if (info.size > maxBytes) throw new EditorialError('FILE_SIZE', `Input overskrider ${maxBytes} bytes`, absolute);
  const bytes = readFileSync(absolute);
  const text = bytes.toString('utf8');
  if (secretScan) scanSecrets(text, absolute);
  return { absolute, bytes, text, hash: sha256(bytes) };
}

export function readJsonFile(file, options = {}) {
  const input = readTextFile(file, options);
  let value;
  try {
    value = JSON.parse(input.text);
  } catch (error) {
    throw new EditorialError('JSON_PARSE', `Ugyldig JSON: ${error.message}`, input.absolute);
  }
  inspectValue(value, options);
  return { ...input, value };
}

export function readNdjsonFile(file, options = {}) {
  const input = readTextFile(file, options);
  const lines = input.text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const values = lines.map((line, index) => {
    if (!line.trim()) throw new EditorialError('NDJSON_EMPTY_LINE', 'NDJSON må ikke have tomme linjer', `${input.absolute}:${index + 1}`);
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new EditorialError('NDJSON_PARSE', `Ugyldig JSON-linje: ${error.message}`, `${input.absolute}:${index + 1}`);
    }
    inspectValue(value, { ...options, path: `$line${index + 1}` });
    return value;
  });
  return { ...input, lines, values };
}

export function assertPrivateOperationalPath(file, repoRoot) {
  const absolute = resolve(file);
  const root = realpathSync(resolve(repoRoot));
  const rel = relative(root, absolute);
  const inside = rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
  if (inside && !rel.split(sep).join('/').startsWith('test/fixtures/phase-4/')) {
    throw new EditorialError('PRIVATE_PATH_REQUIRED', 'Levende redaktionelle artefakter skal ligge uden for det offentlige repository', absolute);
  }
}

export function resolveContainedArtifact(manifestFile, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    throw new EditorialError('MANIFEST_PATH', 'Artifact-stien skal være relativ og må ikke indeholde ..', relativePath);
  }
  const base = realpathSync(dirname(resolve(manifestFile)));
  const candidate = resolve(base, relativePath);
  let candidateReal;
  try {
    const info = lstatSync(candidate);
    if (info.isSymbolicLink()) throw new EditorialError('MANIFEST_SYMLINK', 'Backup-artifacts må ikke være symbolske links', relativePath);
    candidateReal = realpathSync(candidate);
  } catch (error) {
    if (error instanceof EditorialError) throw error;
    throw new EditorialError('MANIFEST_FILE_MISSING', 'Backup-artifact mangler', relativePath);
  }
  const rel = relative(base, candidateReal);
  if (rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith(sep)) {
    throw new EditorialError('MANIFEST_PATH_ESCAPE', 'Backup-artifact forlader manifestmappen', relativePath);
  }
  if (!statSync(candidateReal).isFile()) throw new EditorialError('MANIFEST_FILE_TYPE', 'Backup-artifact skal være en almindelig fil', relativePath);
  return candidateReal;
}
