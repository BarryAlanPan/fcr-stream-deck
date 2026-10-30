import { chromium } from 'playwright-core';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { access, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/actions.mjs';
import { keySvg } from '../src/render.mjs';

const candidates = [process.env.FCR_TEST_CHROME, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executablePath;
for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
if (!executablePath) throw new Error('Set FCR_TEST_CHROME to a Chrome or Edge executable.');
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(ws, 'listening');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 340, height: 700 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const messages = []; let socket;
  ws.on('connection', peer => {
    socket = peer; peer.on('message', data => {
      const event = JSON.parse(data); messages.push(event);
      if (event.event === 'sendToPlugin') peer.send(JSON.stringify({ event: 'sendToPropertyInspector', payload: { phase: 'ready', healthy: true, busy: false, status: 'Connected...', error: '', warning: '' } }));
    });
  });
  await page.goto(new URL('../com.local.fcr.sdPlugin/ui/settings.html', import.meta.url).href);
  await page.evaluate(port => window.connectElgatoStreamDeckSocket(port, 'test-inspector', 'registerPropertyInspector', '{}', JSON.stringify({ context: 'record-1', action: 'com.local.fcr.startrecord', payload: { settings: {} } })), ws.address().port);
  await page.getByText('FCR available', { exact: true }).waitFor();
  assert.equal(await page.locator('#position').count(), 0);
  await page.locator('#server').fill('http://example.com/'); await page.locator('#save').click();
  assert.match(await page.locator('#validation').textContent(), /local HTTP URL/);
  assert.equal(messages.filter(m => m.event === 'setSettings').length, 0);
  await page.locator('#server').fill('http://127.0.0.1:8085/'); await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#validation').textContent === '');
  assert.deepEqual(messages.find(m => m.event === 'setSettings').payload, { serverUrl: 'http://127.0.0.1:8085/' });
  await page.screenshot({ path: new URL('../test-results/property-inspector.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  socket.send(JSON.stringify({ event: 'sendToPropertyInspector', payload: { phase: 'confirming', healthy: false, busy: true, status: 'Connected...', error: 'FCR request timed out', warning: 'Response not confirmed. Check FCR before repeating; the command may have run.' } }));
  await page.locator('#acknowledge').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#retry').isEnabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: new URL('../test-results/property-inspector-warning.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.locator('#acknowledge').click();
  await page.waitForFunction(() => document.querySelector('#acknowledge').hidden);
  assert.ok(messages.some(m => m.payload?.type === 'acknowledge'));
  assert.deepEqual(errors, []);
  const cards = ACTIONS.map(a => `<div>${keySvg({ title: a.title, glyph: a.id, state: ['startrecord', 'ghost'].includes(a.id) ? 'active' : 'ready', active: ['startrecord', 'ghost'].includes(a.id) })}<p>${a.name}</p></div>`).join('');
  const html = `<html><style>body{background:#0c121b;color:#b9cadb;font:14px Arial;padding:24px}main{display:grid;grid-template-columns:repeat(8,144px);gap:20px}p{max-width:144px;text-align:center}h1{color:white;font-size:24px}</style><h1>FlightControlReplay · Stream Deck controls</h1><main>${cards}</main></html>`;
  await writeFile(new URL('../test-results/keys.html', import.meta.url), html);
  await page.setViewportSize({ width: 1370, height: 540 }); await page.setContent(html);
  await page.screenshot({ path: new URL('../test-results/keys.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  console.log('Property inspector: registration, settings, validation, status, warning, acknowledgement and 340px layout passed.');
} finally {
  await browser.close(); for (const socket of ws.clients) socket.terminate(); ws.close();
}
