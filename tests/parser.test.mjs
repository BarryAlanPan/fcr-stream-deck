import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePage } from '../src/parser.mjs';
import { normalizeUrl, seekPercent } from '../src/actions.mjs';
export const connected = readFileSync(new URL('fixtures/connected.html', import.meta.url), 'utf8');
export const recording = readFileSync(new URL('fixtures/recording.html', import.meta.url), 'utf8');
const disconnected = readFileSync(new URL('fixtures/disconnected.html', import.meta.url), 'utf8');
const token = 'a8544c85-365c-4013-9216-daa57d789cb0';

test('captured pages expose all 14 actions, successful submit bodies and status', () => {
  const page = parsePage(connected);
  assert.equal(Object.keys(page.actions).length, 14);
  assert.equal(page.actions.connection.active, true);
  assert.equal(page.actions.play.body, 'play=Play');
  assert.equal(page.actions.loadR.body, 'load=Load');
  assert.equal(page.actions.stop.body, '');
  assert.equal(page.status, 'Connected...');
  assert.deepEqual(page.timeline, { min: 1, max: 1090, value: 1, disabled: false });
  assert.equal(parsePage(disconnected).actions.play.disabled, true);
  assert.equal(parsePage(recording).actions.startrecord.active, true);
});
test('rotating tokens, HTML entities, hidden values and live labels are preserved', () => {
  const html = connected.replaceAll(token, '12345678-1234-5678-abcd-123456789abc')
    .replace('name="play" value="Play"', 'name="play" value="Pause &amp; Resume"')
    .replace('name="load"', 'name="load"')
    .replace('<input  type="submit" name="load"', '<input type="hidden" name="token" value="a&amp;b +c"><input type="hidden" name="omit" value="x" disabled><input type="submit" name="load"');
  const page = parsePage(html);
  assert.match(page.actions.play.url, /12345678-1234-5678-abcd-123456789abc$/);
  assert.equal(page.actions.play.body, 'play=Pause+%26+Resume');
  assert.equal(page.actions.loadR.body, 'token=a%26b+%2Bc&load=Load');
});
test('duplicates, overrides, foreign origins, unknown documents and redirects cannot supply commands', () => {
  const form = connected.match(/<form action="play[^]*?<\/form>/)[0];
  assert.throws(() => parsePage(connected + form), /Ambiguous/);
  assert.throws(() => parsePage(connected.replace('name="play"', 'formaction="/other" name="play"')), /override/);
  assert.throws(() => parsePage(connected.replace('action="play', 'action="http://evil.test/play')), /Unrecognized/);
  assert.throws(() => parsePage('<html>Error</html>'), /Unrecognized/);
  assert.throws(() => parsePage(connected.replace('action="play', 'action="//evil.test/play')), /Unrecognized/);
  assert.throws(() => parsePage(connected.replace(`action="play${token}"`, `action="play${token}?bad=1"`)), /Unrecognized/);
  assert.equal(parsePage(connected.replace('action="play', 'action="http://localhost:8085/play')).actions.play.body, 'play=Play');
});
test('disabled fieldsets and invalid/missing slider bounds fail closed', () => {
  const page = parsePage(connected.replace('<fieldset> <legend>Actions', '<fieldset disabled> <legend>Actions'));
  assert.equal(page.actions.play.disabled, true);
  assert.equal(page.timeline.disabled, true);
  assert.equal(parsePage(connected.replace('max="1090"', 'max="NaN"')).timeline, null);
  assert.equal(parsePage(connected.replace('min="1"', '')).timeline, null);
});
test('server aliases share a lock identity and invalid configuration is rejected', () => {
  assert.equal(normalizeUrl('http://localhost:8085'), 'http://127.0.0.1:8085/');
  assert.equal(normalizeUrl('http://[::1]:8085/'), 'http://127.0.0.1:8085/');
  for (const value of ['https://localhost:8085/', 'http://example.com/', 'http://user@localhost/', 'http://localhost/path', 'http://localhost/?q=x']) assert.throws(() => normalizeUrl(value));
  assert.equal(seekPercent({}), 50);
  for (const value of ['', ' ', null, 'bad', -1, 101, {}, true]) {
    if (value === null) continue; // An unset/null setting uses the default.
    assert.equal(seekPercent({ position: value }), null);
  }
});
