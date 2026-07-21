import { EditorialError } from './editorial-files.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new EditorialError('SCHEMA_REF', `Kun lokale schema-referencer understøttes: ${ref}`);
  return ref.slice(2).split('/').reduce((value, part) => value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

function validDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function validFormat(value, format) {
  if (value === null) return true;
  if (format === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (format === 'date') return validDate(value);
  if (format === 'date-time') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
  if (format === 'http-url') {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }
  return true;
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateNode(value, schema, root, path, errors) {
  if (schema.$ref) return validateNode(value, resolveRef(root, schema.$ref), root, path, errors);
  if (schema.oneOf) {
    const outcomes = schema.oneOf.map(option => {
      const local = [];
      validateNode(value, option, root, path, local);
      return local;
    });
    if (outcomes.filter(result => result.length === 0).length !== 1) errors.push(`${path}: matcher ikke præcis ét oneOf-schema`);
    return;
  }
  if ('const' in schema && !same(value, schema.const)) errors.push(`${path}: skal være ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some(item => same(item, value))) errors.push(`${path}: værdi er ikke i enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => matchesType(value, type))) {
      errors.push(`${path}: forkert type; forventede ${types.join('|')}`);
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: streng er for kort`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: streng er for lang`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path}: matcher ikke pattern`);
    if (schema.format && !validFormat(value, schema.format)) errors.push(`${path}: ugyldigt format ${schema.format}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: mindre end minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: større end maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: for få elementer`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: for mange elementer`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: elementer skal være unikke`);
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, root, `${path}[${index}]`, errors));
  }
  if (isObject(value)) {
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}: mangler feltet ${key}`);
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) errors.push(`${path}: ukendt felt ${key}`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateNode(value[key], childSchema, root, `${path}.${key}`, errors);
    }
  }
}

export function schemaErrors(value, schema) {
  const errors = [];
  validateNode(value, schema, schema, '$', errors);
  return errors;
}

export function assertSchema(value, schema, context = '') {
  const errors = schemaErrors(value, schema);
  if (errors.length) throw new EditorialError('SCHEMA_INVALID', errors.slice(0, 5).join('; '), context);
}
