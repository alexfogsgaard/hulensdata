#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createReport } from './lib/report.mjs';
import { extractAttribute, listPublicHtml, readHtml, routeForFile } from './lib/site.mjs';

const root = process.cwd();
const host = 'https://hulensdata.dk';
const report = createReport('SEO-kontrol');
const files = listPublicHtml(root, { include404: false });
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const sitemapSet = new Set(sitemapUrls);
const canonicalToFile = new Map();
const titleToFile = new Map();

if (sitemapSet.size !== sitemapUrls.length) report.blocker('SEO_SITEMAP_DUPLICATE', 'Sitemap indeholder dublerede URL’er', 'sitemap.xml');
if (sitemapUrls.some(url => url.includes('?'))) report.blocker('SEO_SITEMAP_QUERY', 'Sitemap må ikke indeholde filter- eller query-URL’er', 'sitemap.xml');

function metaContent(html, name, value) {
  const pattern = new RegExp(`<meta\\b(?=[^>]*\\b${name}=["']${value}["'])[^>]*>`, 'i');
  return extractAttribute(html, pattern, 'content');
}

function jsonLdTypes(value, found = []) {
  if (Array.isArray(value)) value.forEach(item => jsonLdTypes(item, found));
  else if (value && typeof value === 'object') {
    if (value['@type']) found.push(value['@type']);
    Object.values(value).forEach(item => jsonLdTypes(item, found));
  }
  return found;
}

for (const file of files) {
  const rel = relative(root, file);
  const route = routeForFile(root, file);
  const html = readHtml(file);
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = metaContent(html, 'name', 'description');
  const canonical = extractAttribute(html, /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i, 'href');
  const expectedCanonical = host + route;
  const ogTitle = metaContent(html, 'property', 'og:title');
  const ogDescription = metaContent(html, 'property', 'og:description');
  const ogUrl = metaContent(html, 'property', 'og:url');

  if (!title) report.blocker('SEO_TITLE', 'Title mangler', rel);
  else if (titleToFile.has(title)) report.blocker('SEO_TITLE_DUPLICATE', `Dubleret title: ${title}`, `${titleToFile.get(title)}, ${rel}`);
  else titleToFile.set(title, rel);
  if (!description) report.blocker('SEO_DESCRIPTION', 'Meta description mangler', rel);
  if (!canonical) report.blocker('SEO_CANONICAL', 'Canonical mangler', rel);
  else {
    if (canonical !== expectedCanonical) report.blocker('SEO_CANONICAL_ROUTE', `Canonical ${canonical} matcher ikke ${expectedCanonical}`, rel);
    if (canonical.includes('?')) report.blocker('SEO_CANONICAL_QUERY', 'Canonical må ikke indeholde query-parametre', rel);
    if (canonicalToFile.has(canonical)) report.blocker('SEO_CANONICAL_DUPLICATE', `Canonical bruges af flere sider: ${canonical}`, `${canonicalToFile.get(canonical)}, ${rel}`);
    canonicalToFile.set(canonical, rel);
    if (!sitemapSet.has(canonical)) report.blocker('SEO_CANONICAL_SITEMAP', 'Canonical mangler i sitemap', `${rel}: ${canonical}`);
  }
  if (!ogTitle || !ogDescription || !ogUrl) report.blocker('SEO_OPEN_GRAPH', 'Open Graph title, description eller URL mangler', rel);
  if (ogUrl && ogUrl !== canonical) report.blocker('SEO_OG_URL', 'og:url matcher ikke canonical', rel);

  const jsonScripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (!jsonScripts.length) report.blocker('SEO_JSONLD', 'JSON-LD mangler', rel);
  const types = [];
  for (const [index, script] of jsonScripts.entries()) {
    try {
      jsonLdTypes(JSON.parse(script[1]), types);
    } catch (error) {
      report.blocker('SEO_JSONLD_PARSE', `Ugyldig JSON-LD: ${error.message}`, `${rel}#jsonld-${index + 1}`);
    }
  }
  const needsBreadcrumb = /^\/(?:virksomheder|loever|saesoner)\//.test(route)
    || /^\/arkiv\/.+\/$/.test(route) || route === '/metode/';
  if (needsBreadcrumb && !types.includes('BreadcrumbList')) report.blocker('SEO_BREADCRUMB', 'Dyb side mangler BreadcrumbList', rel);
}

for (const url of sitemapSet) {
  if (!canonicalToFile.has(url)) report.blocker('SEO_SITEMAP_ORPHAN', 'Sitemap-URL har ingen tilsvarende canonical side', url);
}

const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${host}/sitemap.xml`)) report.blocker('SEO_ROBOTS_SITEMAP', 'robots.txt mangler korrekt sitemap-reference', 'robots.txt');
const notFound = readFileSync(join(root, '404.html'), 'utf8');
if (!/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(notFound)) report.blocker('SEO_404_NOINDEX', '404-siden mangler noindex', '404.html');

report.finish();
