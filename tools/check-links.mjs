#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createReport } from './lib/report.mjs';
import { extractHrefs, extractIds, listPublicHtml, readHtml, routeForFile } from './lib/site.mjs';

const root = process.cwd();
const host = 'https://hulensdata.dk';
const report = createReport('Linkkontrol');
const files = listPublicHtml(root);
const byRoute = new Map(files.map(file => [routeForFile(root, file), file]));
const idsByRoute = new Map(files.map(file => [routeForFile(root, file), extractIds(readHtml(file))]));

for (const file of files) {
  const sourceRoute = routeForFile(root, file);
  for (const href of extractHrefs(readHtml(file))) {
    if (!href || href === '#' || /^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, host + sourceRoute);
    } catch {
      report.blocker('LINK_URL', `Ugyldig href: ${href}`, relative(root, file));
      continue;
    }
    if (url.origin !== host) continue;
    const targetRoute = decodeURI(url.pathname);
    const target = byRoute.get(targetRoute);
    if (!target) {
      report.blocker('LINK_TARGET', `Internt link peger på en ikke-eksisterende side: ${href}`, `${relative(root, file)} → ${targetRoute}`);
      continue;
    }
    if (url.hash) {
      const id = decodeURIComponent(url.hash.slice(1));
      if (id && !idsByRoute.get(targetRoute)?.has(id)) {
        report.blocker('LINK_FRAGMENT', `Fragmentet #${id} findes ikke på målsiden`, `${relative(root, file)} → ${targetRoute}`);
      }
    }
  }
}

const redirects = readFileSync(join(root, '_redirects'), 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split(/\s+/));
for (const [from, to, status] of redirects) {
  if (!from || !to) {
    report.blocker('REDIRECT_FORMAT', 'Redirect mangler kilde eller mål', from || '(tom linje)');
    continue;
  }
  if (!byRoute.has(to)) report.blocker('REDIRECT_TARGET', `Redirect-målet findes ikke: ${to}`, from);
  if (!['301', '302'].includes(status)) report.warning('REDIRECT_STATUS', `Uventet redirect-status: ${status || 'mangler'}`, from);
}

report.finish();
