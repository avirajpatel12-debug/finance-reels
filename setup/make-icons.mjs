// Draws the Home Screen icon (one design, three sizes) into app/. Run once: node setup/make-icons.mjs
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from '../pipeline/data.js';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#8E2F33"/>
  <rect x="166" y="96" width="212" height="344" rx="40" fill="#2B1B17"/>
  <rect x="146" y="76" width="212" height="344" rx="40" fill="#FFF9F0" stroke="#2B1B17" stroke-width="18"/>
  <path d="M218 190v116l98-58z" fill="#8E2F33" stroke="#2B1B17" stroke-width="16" stroke-linejoin="round"/>
  <path d="M186 372h132" stroke="#2B1B17" stroke-width="14" stroke-linecap="round"/>
</svg>`;
const browser = await chromium.launch({ channel: 'chrome' });
for (const size of [512, 192, 180]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: path.join(ROOT, 'app', `icon-${size}.png`) });
  await page.close();
}
await browser.close();
console.log('icons written');
