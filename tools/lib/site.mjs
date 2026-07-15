import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT_PAGES = new Set([
  'index.html', 'deals.html', 'companies.html', 'investors.html', 'charts.html', '404.html',
]);
const PUBLIC_DIRS = new Set(['arkiv', 'virksomheder', 'loever', 'saesoner', 'metode']);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

export function listPublicHtml(root, { include404 = true } = {}) {
  const files = [];
  for (const name of ROOT_PAGES) {
    if (!include404 && name === '404.html') continue;
    const path = join(root, name);
    try {
      if (statSync(path).isFile()) files.push(path);
    } catch {}
  }
  for (const dir of PUBLIC_DIRS) {
    const path = join(root, dir);
    try {
      if (statSync(path).isDirectory()) walk(path, files);
    } catch {}
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b, 'en'));
}

export function routeForFile(root, file) {
  const rel = relative(root, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  return '/' + rel;
}

export function readHtml(file) {
  return readFileSync(file, 'utf8');
}

export function stripNonVisibleHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractAttribute(html, tagPattern, attribute) {
  const tag = html.match(tagPattern)?.[0];
  if (!tag) return null;
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`${escaped}=["']([^"']+)["']`, 'i'))?.[1] ?? null;
}

export function extractIds(html) {
  return new Set([...html.matchAll(/\sid=["']([^"']+)["']/gi)].map(match => match[1]));
}

export function extractHrefs(html) {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  return [...withoutScripts.matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
}
