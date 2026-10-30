import { chromium } from 'playwright-core';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { access, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/actions.mjs';
import { dialSvg, keySvg } from '../src/render.mjs';

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
  assert.equal(await page.locator('#dial-settings').isVisible(), false);
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
  await page.reload();
  await page.evaluate(port => window.connectElgatoStreamDeckSocket(port, 'dial-inspector', 'registerPropertyInspector', '{}', JSON.stringify({ context: 'dial-1', action: 'com.local.fcr.replay', payload: { settings: {} } })), ws.address().port);
  await page.getByText('FCR available', { exact: true }).waitFor();
  assert.equal(await page.locator('#step-percent').inputValue(), '2');
  const savedBefore = messages.filter(m => m.event === 'setSettings').length;
  for (const value of ['', '0', '101']) {
    await page.locator('#step-percent').fill(value); await page.locator('#save').click();
    assert.match(await page.locator('#validation').textContent(), /between 0.1% and 100%/);
    assert.equal(messages.filter(m => m.event === 'setSettings').length, savedBefore);
  }
  await page.locator('#step-percent').fill('2.5'); await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#validation').textContent === '');
  assert.equal(messages.filter(m => m.event === 'setSettings').at(-1).payload.stepPercent, 2.5);
  socket.send(JSON.stringify({ event: 'didReceiveSettings', payload: { settings: { stepPercent: 7.5 } } }));
  await page.waitForFunction(() => document.querySelector('#step-percent').value === '7.5');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: new URL('../test-results/dial-property-inspector.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
  const cards = ACTIONS.filter(a => a.id !== 'replay').map(a => `<div>${keySvg({ title: a.title, glyph: a.id, state: ['startrecord', 'ghost'].includes(a.id) ? 'active' : 'ready', active: ['startrecord', 'ghost'].includes(a.id) })}<p>${a.name}</p></div>`).join('');
  const html = `<html><style>body{background:#0c121b;color:#b9cadb;font:14px Arial;padding:24px}main{display:grid;grid-template-columns:repeat(8,144px);gap:20px}p{max-width:144px;text-align:center}h1{color:white;font-size:24px}</style><h1>FlightControlReplay · Stream Deck controls</h1><main>${cards}</main></html>`;
  await writeFile(new URL('../test-results/keys.html', import.meta.url), html);
  await page.setViewportSize({ width: 1370, height: 540 }); await page.setContent(html);
  await page.screenshot({ path: new URL('../test-results/keys.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  const dialClient = (value, overrides = {}) => ({ healthy: true, phase: 'ready', snapshot: {
    timeline: { min: 0, max: 100, value, disabled: false },
    actions: { play: { label: 'Play', disabled: false }, stop: { disabled: false }, startrecord: { active: false }, connection: { active: true } },
  }, ...overrides });
  const playing = dialClient(50); playing.snapshot.actions.play.label = 'Pause';
  const recording = dialClient(24); recording.snapshot.actions.startrecord.active = true;
  const dials = [dialClient(0), playing, dialClient(100), dialClient(50, { busy: true }),
    dialClient(50, { healthy: false, phase: 'offline' }), recording, dialClient(50, { warning: 'timeout' }), null];
  await page.setViewportSize({ width: 920, height: 300 });
  await page.setContent(`<body style="background:#253347;display:grid;grid-template-columns:repeat(4,200px);gap:20px;padding:10px">${dials.map(c => dialSvg(c)).join('')}</body>`);
  await page.screenshot({ path: new URL('../test-results/dials.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  console.log('Property inspector: registration, settings, validation, status, warning, acknowledgement and 340px layout passed.');
} finally {
  await browser.close(); for (const socket of ws.clients) socket.terminate(); ws.close();
}
