import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { request } from '../src/http.mjs';

const connected = readFileSync(new URL('fixtures/connected.html', import.meta.url), 'utf8');
const token = 'a8544c85-365c-4013-9216-daa57d789cb0';
const nextToken = '12345678-1234-5678-abcd-123456789abc';
async function server(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/`;
}
async function until(predicate, message, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
test('HTTP sends exact form/JSON bytes, no browser Origin, and refuses redirects', async t => {
  const received = [];
  const url = await server(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/should-not-run' }); res.end(); }
    else res.end(connected);
  });
  await request('POST', url + 'play' + token, 'play=Pause+%26+Resume', 'application/x-www-form-urlencoded');
  await request('POST', url + 'slider_update?546', '546', 'application/json');
  assert.equal(received[0].headers.origin, undefined);
  assert.equal(received[0].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(received[0].body, 'play=Pause+%26+Resume');
  assert.equal(received[1].headers.accept, 'application/json');
  assert.equal(received[1].body, '546');
  await assert.rejects(request('POST', url + 'redirect', '', 'application/x-www-form-urlencoded'), /302/);
  assert.equal(received.length, 3);
});
test('HTTP absolute deadline ends a hanging response without retrying', async t => {
  let count = 0;
  const url = await server(t, () => { count++; });
  await assert.rejects(request('POST', url, '', 'application/x-www-form-urlencoded', { timeout: 60 }), /timed out/);
  assert.equal(count, 1);
});
test('compiled plugin registers, shares state/lock, handles settings and exits with Stream Deck', async t => {
  const posts = []; let html = connected, pendingPost;
  const url = await server(t, async (req, res) => {
    if (req.method === 'GET') { res.end(html); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    posts.push({ path: req.url, body }); pendingPost = res;
  });
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(ws, 'listening');
  t.after(() => { for (const socket of ws.clients) socket.terminate(); ws.close(); });
  const process = spawn(globalThis.process.execPath, [fileURLToPath(new URL('../com.local.fcr.sdPlugin/bin/plugin.cjs', import.meta.url)), '-port', String(ws.address().port), '-pluginUUID', 'test-registration', '-registerEvent', 'registerPlugin', '-info', '{}'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; process.stderr.on('data', data => { errors += data; });
  t.after(() => { if (process.exitCode === null) process.kill(); });
  const connection = once(ws, 'connection');
  const [socket] = await connection;
  const messages = []; socket.on('message', data => messages.push(JSON.parse(data)));
  await until(() => messages.some(m => m.event === 'registerPlugin'), 'Plugin registration missing');
  assert.equal(messages.find(m => m.event === 'registerPlugin').uuid, 'test-registration');
  const send = (event, context = 'play-1', action = 'play', payload = {}) => socket.send(JSON.stringify({ event, context, action: `com.local.fcr.${action}`, payload }));
  send('willAppear', 'play-1', 'play', { settings: { serverUrl: url } });
  send('willAppear', 'play-2', 'play', { settings: { serverUrl: url.replace('127.0.0.1', 'localhost') } });
  send('sendToPlugin', 'play-1', 'play', { type: 'status' });
  await until(() => messages.some(m => m.event === 'sendToPropertyInspector' && m.payload.healthy), 'Initial status missing');
  assert.ok(messages.some(m => m.event === 'setImage' && m.context === 'play-2'));
  html = connected.replaceAll(token, nextToken).replace('value="Play"', 'value="Pause"');
  send('keyDown'); send('keyDown', 'play-2');
  await until(() => posts.length === 1 && messages.some(m => m.event === 'showAlert' && m.context === 'play-2'), 'Shared command lock missing');
  assert.equal(posts[0].path, '/play' + nextToken); assert.equal(posts[0].body, 'play=Pause');
  send('willDisappear', 'play-1');
  send('willAppear', 'play-1', 'play', { settings: { serverUrl: url } });
  send('keyDown');
  await until(() => messages.some(m => m.event === 'showAlert' && m.context === 'play-1'), 'Profile switch lost lock');
  pendingPost.end('OK');
  send('sendToPlugin', 'play-1', 'play', { type: 'status' });
  await until(() => messages.some(m => m.event === 'sendToPropertyInspector' && m.payload.phase === 'ready' && m.payload.healthy && messages.indexOf(m) > messages.findIndex(n => n.event === 'showAlert')), 'Confirmation missing');
  const decoded = messages.filter(m => m.event === 'setImage').map(m => Buffer.from(m.payload.image.split(',')[1], 'base64').toString());
  assert.ok(decoded.some(svg => svg.includes('Pause') && svg.includes('ACTIVE')));
  const before = posts.length;
  send('didReceiveSettings', 'play-1', 'play', { settings: { serverUrl: 'http://example.com/' } });
  send('keyDown');
  await until(() => messages.some(m => m.event === 'sendToPropertyInspector' && m.payload.phase === 'configuration'), 'Invalid URL not reported');
  assert.equal(posts.length, before);
  const exited = once(process, 'exit'); socket.close();
  const [code] = await exited;
  assert.equal(code, 0, errors); assert.equal(errors, '');
});
