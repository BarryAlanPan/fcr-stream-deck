import { canSeek, replayCommand, replayPlaying, seekValue } from './replay.mjs';

export const GLYPHS = {
  replay: '<path d="M7 35h36M16 29v12M19 7L36 17 19 27Z"/>',
  startrecord: '<circle cx="25" cy="25" r="15" fill="currentColor" stroke="none"/>',
  play: '<path d="M15 9L41 25 15 41Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M17 10v30M33 10v30" stroke-width="9"/>',
  stop: '<rect x="11" y="11" width="28" height="28" rx="3" fill="currentColor" stroke="none"/>',
  loadR: '<path d="M4 15h17l5 6h20l-6 22H4ZM4 15V8h17l5 7h16v6"/>',
  goStart: '<path d="M9 9v32M39 10L17 25 39 40Z"/>',
  goEnd: '<path d="M41 9v32M11 10L33 25 11 40Z"/>',
  backw: '<path d="M25 10L6 25 25 40ZM44 10L25 25 44 40Z"/>',
  forw: '<path d="M6 10L25 25 6 40ZM25 10L44 25 25 40Z"/>',
  relive: '<path d="M11 17a18 18 0 1 1-3 19M4 7v14h14"/><path d="M22 16L34 25 22 34Z" fill="currentColor" stroke="none"/>',
  takeControl: '<path d="M25 5v35M6 25l19-10 19 10M15 44l10-6 10 6"/>',
  cameraCycle: '<rect x="5" y="15" width="30" height="25" rx="4"/><path d="M35 23l11-7v23l-11-7M12 15l4-7h10l4 7"/>',
  ghost: '<path d="M9 43V21a16 16 0 0 1 32 0v22l-8-5-8 5-8-5Z"/><path d="M19 21v4M31 21v4"/>',
  status: '<circle cx="25" cy="25" r="19"/><path d="M25 23v14M25 13v2"/>',
};
export function stateFor(action, client) {
  let title = action.title, state = 'ready', active = false, glyph = action.id;
  if (!client) return { title, state: 'config', active, glyph };
  const snapshot = client.snapshot, current = snapshot?.actions[action.id];
  const recording = !!snapshot?.actions.startrecord.active;
  if (action.id === 'startrecord' && recording) title = 'Stop rec';
  if (action.id === 'play' && current) {
    title = /^pause/i.test(current.label) ? 'Pause' : /^resume/i.test(current.label) ? 'Resume' : 'Play';
    if (title === 'Pause') glyph = 'pause';
  }
  active = !!current?.active || (action.id === 'play' && title === 'Pause');
  if (action.id === 'startrecord') active = recording;
  let enabled = !!current && !current.disabled;
  if (action.id === 'startrecord' && recording) enabled = !!snapshot.actions.stop && !snapshot.actions.stop.disabled;
  if (action.id === 'play' && recording) enabled = false;
  if (client.phase === 'preparing') state = 'checking';
  else if (client.phase === 'sending') state = 'sending';
  else if (client.busy) state = 'checking';
  else if (!client.healthy) state = client.phase === 'reading' ? 'reading' : 'offline';
  else if (client.warning) state = 'check FCR';
  else if (!enabled) state = 'disabled';
  else if (active) state = 'active';
  return { title, state, active, glyph };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function keySvg(view) {
  const color = ['offline', 'config'].includes(view.state) ? '#f28778' : ['checking', 'sending', 'reading', 'check FCR'].includes(view.state) ? '#f3c66c' : view.state === 'disabled' ? '#738092' : view.active ? (view.glyph === 'startrecord' ? '#ff747d' : '#69e3c0') : '#dce7f4';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="14" fill="#101923"/><rect x="7" y="7" width="130" height="130" rx="10" fill="#192635" stroke="${color}" stroke-opacity=".4"/><g transform="translate(47 23)" fill="none" stroke="currentColor" color="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[view.glyph] || GLYPHS.status}</g><text x="72" y="99" fill="${color}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${view.title.length > 9 ? 16 : 19}" font-weight="700">${escape(view.title)}</text><text x="72" y="122" fill="${color}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" letter-spacing="1">${escape(view.state.toUpperCase())}</text></svg>`;
}
export const keyImage = view => `data:image/svg+xml;base64,${Buffer.from(keySvg(view)).toString('base64')}`;

export function dialSvg(client, pendingTicks = 0, step) {
  const snapshot = client?.snapshot, timeline = snapshot?.timeline;
  const playing = replayPlaying(snapshot);
  const command = snapshot?.actions[replayCommand(snapshot)];
  let state = playing ? 'PLAYING' : 'READY';
  let hint = playing ? 'Press to stop' : 'Press to start';
  let color = playing ? '#69e3c0' : '#dce7f4';
  const fresh = client?.healthy && timeline;
  const progress = fresh ? Math.max(0, Math.min(100, 100 *
    ((pendingTicks ? seekValue(timeline, pendingTicks, step) : timeline.value) - timeline.min) / (timeline.max - timeline.min))) : null;
  if (!client) { state = 'SETUP'; hint = 'Check server settings'; color = '#f28778'; }
  else if (client.warning) { state = 'CHECK FCR'; hint = 'Check before retrying'; color = '#f3c66c'; }
  else if (client.busy || pendingTicks) { state = pendingTicks ? 'SEEKING' : 'CHECKING'; hint = 'Updating replay'; color = '#f3c66c'; }
  else if (!client.healthy) { state = client.phase === 'reading' ? 'READING' : 'OFFLINE'; hint = 'Waiting for FCR'; color = '#f28778'; }
  else if (snapshot?.actions.startrecord.active) { state = 'RECORDING'; hint = 'Replay unavailable'; color = '#ff747d'; }
  else if (!canSeek(snapshot)) { state = 'NO TIMELINE'; hint = command && !command.disabled ? hint : 'Load a replay in FCR'; color = '#738092'; }
  else if (!command || command.disabled) hint = 'Turn to seek';
  const label = progress === null ? '--' : `${Math.round(progress)}%`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#101923"/><text x="12" y="19" fill="${color}" font-family="Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="1">${state}</text><text x="188" y="49" text-anchor="end" fill="${color}" font-family="Arial,sans-serif" font-size="28" font-weight="700">${label}</text><g transform="translate(12 28) scale(.46)" fill="none" stroke="${color}" color="${color}" stroke-width="3.5">${GLYPHS[playing ? 'stop' : 'play']}</g><rect x="12" y="59" width="176" height="8" rx="4" fill="#304155"/><rect x="12" y="59" width="${176 * (progress || 0) / 100}" height="8" rx="4" fill="${color}"/><text x="100" y="88" text-anchor="middle" fill="${color}" font-family="Arial,sans-serif" font-size="12">${escape(hint)}</text></svg>`;
}
export const dialImage = (client, ticks, step) => `data:image/svg+xml;base64,${Buffer.from(dialSvg(client, ticks, step)).toString('base64')}`;
