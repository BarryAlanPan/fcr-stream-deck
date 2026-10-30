import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DeckController } from '../src/controller.mjs';
import { FcrClient } from '../src/client.mjs';
import { dialSvg } from '../src/render.mjs';
import { parsePage } from '../src/parser.mjs';

const connected = readFileSync(new URL('fixtures/connected.html', import.meta.url), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); }
  assert.fail('Timed out waiting for dial');
}
async function setup(t) {
  let value = 546, hold, fail = false;
  const posts = [], messages = [];
  const client = new FcrClient(undefined, { pollMs: 100000, transport: async (method, url, body) => {
    if (method === 'POST') {
      posts.push({ url, body });
      if (hold) await hold;
      if (fail) throw new Error('timeout');
      if (url.includes('slider_update')) value = Number(body);
    }
    return connected.replace('value="0" class="slider"', `value="${value}" class="slider"`);
  } });
  const controller = new DeckController(message => messages.push(message), () => client);
  t.after(() => controller.close());
  const send = (event, payload = {}, context = 'dial') => controller.handle({ event, context, action: 'com.local.fcr.replay', payload });
  await send('willAppear', { controller: 'Encoder' }); await client.poll();
  return { client, controller, posts, messages, send, hold: promise => { hold = promise; }, fail: () => { fail = true; } };
}

test('encoder feedback, batched turns, in-flight turns, single press and touch toggle', async t => {
  const { client, posts, messages, send, hold } = await setup(t);
  assert.ok(messages.some(m => m.event === 'setFeedback' && m.payload.replay));
  assert.ok(!messages.some(m => m.event === 'setImage'));
  let release; hold(new Promise(resolve => { release = resolve; }));
  await send('dialRotate', { ticks: 1 }); await send('dialRotate', { ticks: 2 });
  await until(() => posts.length === 1);
  assert.equal(posts[0].body, '612');
  await send('dialRotate', { ticks: -2 });
  release(); await until(() => posts.length === 2 && !client.busy);
  assert.equal(posts[1].body, '568');
  await send('dialDown'); await send('dialUp');
  assert.equal(posts.length, 3); assert.equal(posts[2].body, 'play=Play');
  await send('touchTap'); assert.equal(posts.length, 4);
});

test('hiding a dial or changing settings cancels unsent turns', async t => {
  const { posts, send } = await setup(t);
  await send('dialRotate', { ticks: 3 }); await send('willDisappear');
  await delay(180); assert.equal(posts.length, 0);
  await send('willAppear');
  await delay(10);
  await send('dialRotate', { ticks: 3 }); await send('didReceiveSettings', { settings: {} });
  await delay(180); assert.equal(posts.length, 0);
});

test('step settings apply per dial to the preview and seek, including decimals and invalid fallback', async t => {
  const { client, posts, messages, send } = await setup(t);
  await send('didReceiveSettings', { settings: { stepPercent: 0.5 } });
  await send('dialRotate', { ticks: 2 });
  const preview = messages.filter(m => m.event === 'setFeedback').at(-1).payload.replay;
  assert.match(Buffer.from(preview.split(',')[1], 'base64').toString(), /51%/);
  await until(() => posts.length === 1 && !client.busy);
  assert.equal(posts[0].body, '556');
  await send('willAppear', { settings: {} }, 'default-dial');
  await send('dialRotate', { ticks: 1 }, 'default-dial');
  await until(() => posts.length === 2 && !client.busy);
  assert.equal(posts[1].body, '578');
  await send('didReceiveSettings', { settings: { stepPercent: 5 } });
  await send('dialRotate', { ticks: -1 });
  await until(() => posts.length === 3 && !client.busy);
  assert.equal(posts[2].body, '524');
  await send('didReceiveSettings', { settings: { stepPercent: -1 } });
  await send('dialRotate', { ticks: 1 });
  await until(() => posts.length === 4 && !client.busy);
  assert.equal(posts[3].body, '546');
});

test('uncertain seek discards pending turns and never retries automatically', async t => {
  const { posts, send, hold, fail, client } = await setup(t);
  let release; hold(new Promise(resolve => { release = resolve; })); fail();
  await send('dialRotate', { ticks: 1 }); await until(() => posts.length === 1);
  await send('dialRotate', { ticks: 4 }); release();
  await until(() => !!client.warning && !client.busy);
  await delay(180); assert.equal(posts.length, 1);
  await send('dialRotate', { ticks: 1 }); await delay(180); assert.equal(posts.length, 1);
});

test('dial shares command lock with keys and press cancels a pending turn', async t => {
  const { client, posts, send } = await setup(t);
  await send('dialRotate', { ticks: 4 }); await send('dialDown');
  await delay(180); assert.equal(posts.length, 1); assert.equal(posts[0].body, 'play=Play');
  client.busy = true;
  await send('dialRotate', { ticks: 2 }); await send('touchTap');
  await delay(180); assert.equal(posts.length, 1);
});

test('display distinguishes progress, playback, offline, recording and warning states', () => {
  const client = { healthy: true, phase: 'ready', snapshot: parsePage(connected.replace('value="0" class="slider"', 'value="546" class="slider"')) };
  assert.match(dialSvg(client), /50%/); assert.match(dialSvg(client), /Press to start/);
  client.snapshot.actions.play.label = 'Pause';
  assert.match(dialSvg(client), /PLAYING/); assert.match(dialSvg(client), /Press to stop/);
  client.healthy = false; client.phase = 'offline';
  assert.match(dialSvg(client), /OFFLINE/); assert.doesNotMatch(dialSvg(client), /50%/);
  client.healthy = true; client.snapshot.actions.startrecord.active = true;
  assert.match(dialSvg(client), /RECORDING/);
  client.warning = 'timeout'; assert.match(dialSvg(client), /CHECK FCR/);
});
