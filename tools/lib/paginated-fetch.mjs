const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

function parseContentRange(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+)-(\d+)\/(\d+|\*)$/);
  if (!match) throw new Error(`Ugyldig Content-Range fra REST: ${value}`);
  const [, rawStart, rawEnd, rawTotal] = match;
  return {
    start: Number(rawStart),
    end: Number(rawEnd),
    total: rawTotal === '*' ? null : Number(rawTotal),
  };
}

export async function fetchAllPages(url, {
  headers = {},
  pageSize = DEFAULT_PAGE_SIZE,
  fetchImpl = fetch,
} = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize skal være et positivt heltal');

  const rows = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetchImpl(url, {
      headers: {
        ...headers,
        Prefer: 'count=exact',
        Range: `${offset}-${offset + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!response.ok) {
      const detail = typeof response.text === 'function' ? await response.text() : '';
      throw new Error(`REST ${response.status} på ${url}${detail ? `: ${detail}` : ''}`);
    }
    const pageRows = await response.json();
    if (!Array.isArray(pageRows)) throw new Error(`REST-svaret på ${url} er ikke en liste`);
    if (!pageRows.length) return rows;

    const range = parseContentRange(response.headers?.get?.('content-range'));
    if (range && range.start !== offset) {
      throw new Error(`REST-pagination gentog eller sprang et interval over på ${url}: forventede start ${offset}, fik ${range.start}`);
    }
    if (range && range.end - range.start + 1 !== pageRows.length) {
      throw new Error(`REST-paginationens Content-Range matcher ikke svarets rækkeantal på ${url}`);
    }

    rows.push(...pageRows);
    offset += pageRows.length;
    const total = range?.total ?? null;
    if (total != null && offset >= total) return rows;
  }
  throw new Error(`REST-pagination overskred ${MAX_PAGES} sider på ${url}`);
}
