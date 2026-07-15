#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const requests = [];
const archive = {
  deals: [{ id: 1 }],
  companies: [{ id: 2 }],
  sources: [{ id: 3 }],
};

const context = vm.createContext({
  console,
  fetch: async url => {
    requests.push(String(url));
    await Promise.resolve();
    return {
      ok: true,
      json: async () => archive,
    };
  },
});

new vm.Script(readFileSync('js/supabase.js', 'utf8'), { filename: 'js/supabase.js' }).runInContext(context);

const [deals, companies, sources] = await Promise.all([
  context.sbFetch('deals?select=id'),
  context.sbFetch('companies?select=id'),
  context.sbFetch('sources?select=id'),
]);

assert.deepEqual(deals, archive.deals);
assert.deepEqual(companies, archive.companies);
assert.deepEqual(sources, archive.sources);
assert.equal(
  requests.filter(url => url.endsWith('/data/arkiv.json')).length,
  1,
  'parallelle datakald skal dele samme snapshot-request',
);

console.log('Snapshot-loading: 3 parallelle datakald · 1 request');

const partialRequests = [];
const partialContext = vm.createContext({
  console,
  fetch: async url => {
    partialRequests.push(String(url));
    if (String(url).endsWith('/data/arkiv.json')) {
      return { ok: true, json: async () => ({ deals: [{ id: 1 }] }) };
    }
    return {
      ok: true,
      headers: { get: () => '0-0/1' },
      json: async () => [{ id: 2 }],
    };
  },
});
new vm.Script(readFileSync('js/supabase.js', 'utf8'), { filename: 'js/supabase.js' }).runInContext(partialContext);

await assert.rejects(
  partialContext.sbFetch('companies?select=id'),
  /Arkivsnapshot mangler den forventede tabel companies/,
  'et delvist snapshot må ikke blandes med live REST-data',
);
assert.equal(
  partialRequests.filter(url => url.includes('/rest/v1/')).length,
  0,
  'et manglende snapshot-array må ikke udløse et tabelspecifikt REST-kald',
);

console.log('Snapshot-atomicitet: delvist snapshot afvist · 0 REST-blandinger');

let repeatedPageCalls = 0;
const repeatedRangeContext = vm.createContext({
  console,
  fetch: async () => {
    repeatedPageCalls++;
    return {
      ok: true,
      headers: { get: () => '0-499/1000' },
      json: async () => Array.from({ length: 500 }, (_, id) => ({ id })),
    };
  },
});
new vm.Script(readFileSync('js/supabase.js', 'utf8'), { filename: 'js/supabase.js' }).runInContext(repeatedRangeContext);
await assert.rejects(
  repeatedRangeContext.sbFetchRestAll('companies?select=id&order=id.asc'),
  /gentog eller sprang et interval over/,
  'browserens REST-fallback må afvise et gentaget server-interval',
);
assert.equal(repeatedPageCalls, 2);

let midFailureCalls = 0;
const midFailureContext = vm.createContext({
  console: { ...console, error() {} },
  fetch: async () => {
    midFailureCalls++;
    if (midFailureCalls === 2) {
      return { ok: false, status: 503, text: async () => 'midlertidig fejl' };
    }
    return {
      ok: true,
      headers: { get: () => '0-499/1000' },
      json: async () => Array.from({ length: 500 }, (_, id) => ({ id })),
    };
  },
});
new vm.Script(readFileSync('js/supabase.js', 'utf8'), { filename: 'js/supabase.js' }).runInContext(midFailureContext);
await assert.rejects(
  midFailureContext.sbFetchRestAll('companies?select=id&order=id.asc'),
  /status 503/,
  'browserens REST-fallback må afbryde hele kaldet ved fejl på en senere side',
);
assert.equal(midFailureCalls, 2);

console.log('Browser-REST: gentaget range og midtvejsfejl afvist');
