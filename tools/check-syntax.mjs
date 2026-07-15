#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { createReport } from './lib/report.mjs';
import { listPublicHtml } from './lib/site.mjs';

const root = process.cwd();
const report = createReport('Syntakstjek');

function walkScripts(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkScripts(path, files);
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

for (const dir of ['js', 'tools']) {
  for (const file of walkScripts(join(root, dir))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      report.blocker('JS_SYNTAX', (result.stderr || result.stdout).trim(), relative(root, file));
    }
  }
}

for (const file of listPublicHtml(root)) {
  const html = readFileSync(file, 'utf8');
  let index = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    index += 1;
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs) || /application\/ld\+json/i.test(attrs)) continue;
    try {
      new Script(match[2], { filename: `${relative(root, file)}#script-${index}` });
    } catch (error) {
      report.blocker('INLINE_SYNTAX', error.message, `${relative(root, file)}#script-${index}`);
    }
  }
}

report.finish();
