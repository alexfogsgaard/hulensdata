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
