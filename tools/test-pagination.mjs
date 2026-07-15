#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fetchAllPages } from './lib/paginated-fetch.mjs';

const dataset = Array.from({ length: 2300 }, (_, id) => ({ id }));
const requestedRanges = [];
const serverMaxRows = 500;

const rows = await fetchAllPages('https://example.invalid/rest/v1/items?order=id.asc', {
  pageSize: 1000,
  fetchImpl: async (_url, options) => {
    const [start, requestedEnd] = options.headers.Range.split('-').map(Number);
    requestedRanges.push(options.headers.Range);
    const end = Math.min(requestedEnd, start + serverMaxRows - 1, dataset.length - 1);
    const page = start < dataset.length ? dataset.slice(start, end + 1) : [];
    return {
      ok: true,
      status: page.length === dataset.length ? 200 : 206,
      headers: { get: name => name.toLowerCase() === 'content-range' ? `${start}-${end}/${dataset.length}` : null },
      json: async () => page,
    };
  },
});

assert.equal(rows.length, dataset.length, 'serverens max-rows må ikke afkorte resultatet');
assert.deepEqual(rows, dataset, 'rækker skal bevares i rækkefølge uden huller eller dubletter');
assert.deepEqual(requestedRanges, ['0-999', '500-1499', '1000-1999', '1500-2499', '2000-2999']);
console.log(`REST-pagination: ${rows.length} rækker over ${requestedRanges.length} sider · server-cap ${serverMaxRows}`);
