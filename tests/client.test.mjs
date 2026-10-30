import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FcrClient } from '../src/client.mjs';
const connected = readFileSync(new URL('fixtures/connected.html', import.meta.url), 'utf8');
const recording = readFileSync(new URL('fixtures/recording.html', import.meta.url), 'utf8');
const disconnected = readFileSync(new URL('fixtures/disconnected.html', import.meta.url), 'utf8');
const token = 'a8544c85-365c-4013-9216-daa57d789cb0';
const nextToken = '12345678-1234-5678-abcd-123456789abc';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function setup(t, transport) {
  const calls = [];
  const client = new FcrClient(undefined, { transport: async (...args) => { calls.push(args); return transport(...args); }, pollMs: 100000, retryMs: 100000 });
  t.after(() => client.close());
  await client.poll();
  return { client, calls, posts: () => calls.filter(c => c[0] === 'POST') };
}
test('fresh tokens and exact named bodies are used; POST is followed by GET', async t => {
  let count = 0;
  const { client, calls, posts } = await setup(t, () => (++count === 1 ? connected : connected.replaceAll(token, nextToken).replace('value="Play"', 'value="Pause"')));
  assert.equal(await client.command('play'), true);
  assert.deepEqual(calls.map(c => c[0]), ['GET', 'GET', 'POST', 'GET']);
  assert.match(posts()[0][1], new RegExp(`play${nextToken}$`));
  assert.equal(posts()[0][2], 'play=Pause');
  assert.equal(client.busy, false);
});
test('record toggles to stop; play never interrupts recording', async t => {
  const { client, posts } = await setup(t, () => recording);
  assert.equal(await client.command('play'), false);
  assert.equal(posts().length, 0);
  assert.equal(await client.command('startrecord'), true);
  assert.match(posts()[0][1], /\/stop/);
});
test('fresh disabled state rejects a previously enabled action', async t => {
  let page = connected;
  const { client, posts } = await setup(t, () => page);
  page = disconnected;
  assert.equal(await client.command('play'), false);
  assert.equal(posts().length, 0);
});
test('concurrent clicks are rejected before preflight finishes', async t => {
  let gate;
  const { client, posts } = await setup(t, () => gate ? gate.promise : connected);
  gate = deferred();
  const first = client.command('play');
  assert.equal(await client.command('stop'), false);
  gate.resolve(connected); gate = null;
  await first;
  assert.equal(posts().length, 1);
});
test('background GET cannot release a command lock or overlap its POST', async t => {
  let gate;
  const { client, calls, posts } = await setup(t, () => gate ? gate.promise : connected);
  gate = deferred();
  const poll = client.poll();
  const command = client.command('play');
  gate.resolve(connected); gate = null;
  await poll;
  assert.equal(client.busy, true);
  assert.equal(await client.command('stop'), false);
  await command;
  assert.equal(posts().length, 1);
  assert.deepEqual(calls.map(c => c[0]), ['GET', 'GET', 'GET', 'POST', 'GET']);
});
test('uncertain POST is never retried; failed confirmations retain lock until valid GET', async t => {
  let posted = false, recover = false;
  const { client, posts } = await setup(t, method => {
    if (method === 'POST') { posted = true; throw new Error('timeout'); }
    if (posted && !recover) throw new Error('offline');
    return connected;
  });
  assert.equal(await client.command('play'), false);
  assert.equal(client.busy, true); assert.match(client.warning, /may have run/);
  assert.equal(await client.command('play'), false);
  await client.poll(); assert.equal(posts().length, 1);
  recover = true; await client.poll();
  assert.equal(client.busy, false); assert.equal(client.healthy, true);
  assert.match(client.warning, /may have run/);
  client.acknowledge(); assert.equal(client.warning, '');
});
test('profile switch preserves in-flight POST and shared lock, then stops polling', async t => {
  const gate = deferred();
  const { client, posts } = await setup(t, method => method === 'POST' ? gate.promise : connected);
  let unsubscribe = client.subscribe(() => {}); await client.poll();
  const command = client.command('play');
  while (!posts().length) await new Promise(resolve => setImmediate(resolve));
  unsubscribe(); assert.equal(client.timer, null);
  unsubscribe = client.subscribe(() => {});
  assert.equal(await client.command('stop'), false);
  gate.resolve('OK'); await command;
  assert.equal(client.busy, false); assert.equal(posts().length, 1);
  unsubscribe(); assert.equal(client.timer, null);
});
