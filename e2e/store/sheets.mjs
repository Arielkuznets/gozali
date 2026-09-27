// Puts screenshots side by side, six to a sheet, for looking over many screens at once:
//   node e2e/store/sheets.mjs e2e/store/output/gallery e2e/store/output/sheets
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [folder, out] = process.argv.slice(2);
const files = readdirSync(folder).filter((f) => f.endsWith('.png')).sort();
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
for (let i = 0; i < files.length; i += 6) {
  const group = files.slice(i, i + 6);
  const cells = group.map((f) => `<figure><figcaption>${f}</figcaption><img src="data:image/png;base64,${readFileSync(join(folder, f)).toString('base64')}"></figure>`).join('');
  await page.setContent(`<body style="margin:0;background:#666;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px;font:12px system-ui;color:#fff">${cells.replaceAll('<figure>', '<figure style="margin:0">').replaceAll('<img ', '<img style="width:100%;display:block" ')}</body>`);
  await page.screenshot({ path: join(out, `sheet-${String(i / 6 + 1).padStart(2, '0')}.png`), fullPage: true });
}
await browser.close();
