#!/usr/bin/env node
/**
 * Generates the bundled product illustrations (apps/web/public/products/*.svg)
 * from the catalog seed data and Lucide icons (ISC licensed). Deterministic:
 * re-running produces identical files. Requires `npm run build:services` first.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { SEED_PRODUCTS } = require(join(root, 'services/catalog/dist/seed/data.js'));
const iconsDir = join(dirname(require.resolve('lucide-static/package.json')), 'icons');
const outDir = join(root, 'apps/web/public/products');
mkdirSync(outDir, { recursive: true });

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

for (const p of SEED_PRODUCTS) {
  const raw = readFileSync(join(iconsDir, `${p.icon}.svg`), 'utf8');
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
  const [a, b] = p.palette;
  const h = hash(p.slug);
  const cx1 = 80 + (h % 120);
  const cy1 = 60 + ((h >> 8) % 100);
  const cx2 = 420 - ((h >> 4) % 120);
  const cy2 = 440 - ((h >> 12) % 100);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${p.name}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.3" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#shine)"/>
  <circle cx="${cx1}" cy="${cy1}" r="120" fill="#fff" opacity="0.08"/>
  <circle cx="${cx2}" cy="${cy2}" r="150" fill="#000" opacity="0.08"/>
  <ellipse cx="256" cy="400" rx="130" ry="18" fill="#000" opacity="0.18"/>
  <g transform="translate(116 106) scale(11.67)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    ${inner}
  </g>
</svg>
`;
  writeFileSync(join(outDir, `${p.slug}.svg`), svg);
}
console.log(`wrote ${SEED_PRODUCTS.length} illustrations to ${outDir}`);
