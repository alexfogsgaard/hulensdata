#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fetchAllPages } from './lib/paginated-fetch.mjs';

function response(rows, range, { ok = true, status = 206, body = '' } = {}) {
  return {
    ok,
    status,
    headers: { get: name => name.toLowerCase() === 'content-range' ? range : null },
    json: async () => rows,
    text: async () => body,
  };
}

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
    return response(page, `${start}-${end}/${dataset.length}`, {
      status: page.length === dataset.length ? 200 : 206,
    });
  },
});

assert.equal(rows.length, dataset.length, 'serverens max-rows må ikke afkorte resultatet');
assert.deepEqual(rows, dataset, 'rækker skal bevares i rækkefølge uden huller eller dubletter');
assert.deepEqual(requestedRanges, ['0-999', '500-1499', '1000-1999', '1500-2499', '2000-2999']);

await assert.rejects(
  fetchAllPages('https://example.invalid/rest/v1/repeated', {
    fetchImpl: async () => response(dataset.slice(0, 500), '0-499/1000'),
  }),
  /gentog eller sprang et interval over/,
  'et gentaget server-interval må ikke blive accepteret som en ny side',
);

let failedRequests = 0;
await assert.rejects(
  fetchAllPages('https://example.invalid/rest/v1/mid-error', {
    pageSize: 500,
    fetchImpl: async (_url, options) => {
      failedRequests++;
      if (failedRequests === 2) return response([], null, { ok: false, status: 503, body: 'midlertidig fejl' });
      const [start, end] = options.headers.Range.split('-').map(Number);
      return response(dataset.slice(start, end + 1), `${start}-${end}/${dataset.length}`);
    },
  }),
  /REST 503/,
  'en fejl midt i pagination må afbryde hele kaldet',
);
assert.equal(failedRequests, 2, 'pagination må ikke fortsætte efter en fejlet side');

await assert.rejects(
  fetchAllPages('https://example.invalid/rest/v1/bad-range', {
    fetchImpl: async () => response(dataset.slice(0, 500), '0-998/2300'),
  }),
  /matcher ikke svarets rækkeantal/,
  'Content-Range og faktisk sidestørrelse skal være konsistente',
);

console.log(`REST-pagination: ${rows.length} rækker over ${requestedRanges.length} sider · server-cap ${serverMaxRows} · gentaget range og midtvejsfejl afvist`);
