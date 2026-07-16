/**
 * Render HTML to PDF with headless Chrome — the same engine as the user's
 * browser print, so server PDFs match what Ctrl+P produces in the web app.
 * Uses puppeteer-core with the system Chrome (CHROME_PATH env or the usual
 * install locations). The browser is launched lazily and reused.
 */
import { promises as fs } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { logger } from '../logger.js';

const CANDIDATE_PATHS = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter((p): p is string => !!p);

async function findChrome(): Promise<string | null> {
  for (const p of CANDIDATE_PATHS) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

let _browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;
  const executablePath = await findChrome();
  if (!executablePath) {
    throw new Error('Chrome not found (set CHROME_PATH or install google-chrome-stable)');
  }
  _browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  logger.info({ executablePath }, 'headless chrome launched for PDF rendering');
  return _browser;
}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Everything is inline (base64 fonts, no network fetches) so 'load' is
    // sufficient; wait for fonts to finish laying out before printing.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    return new Uint8Array(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}
