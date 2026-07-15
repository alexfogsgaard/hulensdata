#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { createReport } from './lib/report.mjs';
import { listPublicHtml, readHtml } from './lib/site.mjs';

const root = process.cwd();
const report = createReport('Tilgængelighedskontrol');
const files = listPublicHtml(root);

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function visibleText(markup) {
  return markup.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
}

for (const file of files) {
  const rel = relative(root, file);
  const html = readHtml(file);
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  if (!/<html\b[^>]*\blang=["']da["']/i.test(html)) report.blocker('A11Y_LANG', 'Siden mangler lang="da"', rel);
  const h1Count = (withoutScripts.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) report.blocker('A11Y_H1', `Siden har ${h1Count} statiske h1-overskrifter; forventede 1`, rel);
  if (/\btabindex=["'][1-9]\d*["']/i.test(withoutScripts)) report.blocker('A11Y_TABINDEX', 'Positiv tabindex forstyrrer dokumentets naturlige tab-rækkefølge', rel);

  for (const match of withoutScripts.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = match[0];
    if (attr(tag, 'type') === 'hidden') continue;
    const id = attr(tag, 'id');
    if (!id) {
      report.blocker('A11Y_CONTROL_ID', `${match[1]} mangler id og kan ikke få en entydig label`, rel);
      continue;
    }
    const explicit = new RegExp(`<label\\b[^>]*\\bfor=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(withoutScripts);
    const before = withoutScripts.slice(0, match.index);
    const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
    if (!explicit && !wrapped && !attr(tag, 'aria-label') && !attr(tag, 'aria-labelledby')) {
      report.blocker('A11Y_CONTROL_LABEL', `${match[1]}#${id} mangler en tilknyttet label`, rel);
    }
  }

  for (const match of withoutScripts.matchAll(/<[^>]+\brole=["']combobox["'][^>]*>/gi)) {
    const tag = match[0];
    for (const required of ['aria-controls', 'aria-expanded', 'aria-autocomplete']) {
      if (attr(tag, required) == null) report.blocker('A11Y_COMBOBOX', `Combobox mangler ${required}`, rel);
    }
  }

  for (const match of withoutScripts.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    if (!visibleText(match[1]) && !attr(match[0], 'aria-label') && !attr(match[0], 'aria-labelledby')) {
      report.blocker('A11Y_BUTTON_NAME', 'Knap mangler et tilgængeligt navn', rel);
    }
  }

  for (const match of withoutScripts.matchAll(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi)) {
    if (!String(attr(match[0], 'rel')).split(/\s+/).includes('noopener')) {
      report.blocker('A11Y_EXTERNAL_REL', 'Eksternt nyt vindue mangler rel="noopener"', rel);
    }
  }

  for (const match of withoutScripts.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    if (!/<caption\b/i.test(match[1])) report.blocker('A11Y_TABLE_CAPTION', 'Tabel mangler caption', rel);
  }
  for (const match of withoutScripts.matchAll(/<div\b[^>]*class=["'][^"']*\btable-wrap\b[^"']*["'][^>]*>/gi)) {
    const wrapper = match[0];
    if (attr(wrapper, 'role') !== 'region' || attr(wrapper, 'tabindex') !== '0' || !attr(wrapper, 'aria-label')) {
      report.blocker('A11Y_SCROLL_REGION', 'Horisontalt tabelområde skal være navngivet og tastaturfokuserbart', rel);
    }
  }

  for (const match of withoutScripts.matchAll(/<canvas\b[^>]*>([\s\S]*?)<\/canvas>/gi)) {
    if (!attr(match[0], 'aria-label') || !visibleText(match[1])) {
      report.blocker('A11Y_CANVAS', 'Canvas mangler aria-label eller fallbacktekst', rel);
    }
  }
}

const css = readFileSync(`${root}/css/style.css`, 'utf8');
if (!/:focus-visible\s*\{[^}]*outline:/s.test(css)) report.blocker('A11Y_FOCUS', 'Global synlig fokusmarkering mangler', 'css/style.css');
if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/i.test(css)) report.blocker('A11Y_REDUCED_MOTION', 'Reduced-motion-regel mangler', 'css/style.css');

const layout = readFileSync(`${root}/js/layout.js`, 'utf8');
if (!/role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-haspopup="listbox"[^>]*aria-controls=/i.test(layout)) {
  report.blocker('A11Y_GLOBAL_COMBOBOX', 'Den fælles søgning mangler komplet combobox-kontrakt', 'js/layout.js');
}
if (!/role="option"[^>]*tabindex="-1"/i.test(layout)) {
  report.blocker('A11Y_GLOBAL_OPTIONS', 'Søgeresultater skal styres med aktiv descendant uden ekstra tabstop', 'js/layout.js');
}

report.finish();
