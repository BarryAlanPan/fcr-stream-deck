/* Stream Deck's property inspector WebSocket API. No FCR requests run in this view. */
let socket, context, action, settings = {}, dirty = false;
const el = id => document.getElementById(id);
const send = value => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
const toPlugin = type => send({ event: 'sendToPlugin', action, context, payload: { type } });
function fill() {
  el('server').value = settings.serverUrl || 'http://127.0.0.1:8085/';
  el('position').value = settings.position ?? 50;
}
window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
  const parsed = JSON.parse(actionInfo); context = parsed.context; action = parsed.action; settings = parsed.payload.settings || {};
  const metadata = window.fcrActions[action];
  if (metadata) { el('title').textContent = metadata.name; el('description').textContent = metadata.description; }
  el('seek').hidden = !action.endsWith('.seek'); fill();
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => {
    send({ event: registerEvent, uuid });
    el('save').disabled = false; el('retry').disabled = false; toPlugin('status');
  };
  socket.onmessage = message => {
    const event = JSON.parse(message.data);
    if (event.event === 'didReceiveSettings') { settings = event.payload.settings || {}; if (!dirty) fill(); }
    if (event.event === 'sendToPropertyInspector') {
      const state = event.payload;
      el('phase').textContent = state.healthy && !state.busy ? 'FCR available' : ({ preparing: 'Checking current controls…', sending: 'Sending command…', confirming: 'Waiting for FCR confirmation…', reading: 'Reading FCR…', offline: 'FCR unavailable', configuration: 'Check server settings' }[state.phase] || state.phase);
      el('status').textContent = state.status; el('error').textContent = state.error; el('warning').textContent = state.warning;
      el('retry').disabled = ['preparing', 'sending'].includes(state.phase);
      el('acknowledge').hidden = !state.warning;
    }
  };
  socket.onclose = () => { el('phase').textContent = 'Stream Deck disconnected'; el('save').disabled = el('retry').disabled = true; };
};
el('server').oninput = el('position').oninput = () => { dirty = true; };
el('save').onclick = () => {
  try {
    const url = new URL(el('server').value.trim());
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a local HTTP URL, e.g. http://127.0.0.1:8085/');
    const position = Number(el('position').value);
    if (action.endsWith('.seek') && (!el('position').value.trim() || !Number.isFinite(position) || position < 0 || position > 100)) throw new Error('Enter a replay position from 0 to 100.');
    settings = { ...settings, serverUrl: url.href, position };
    send({ event: 'setSettings', context, payload: settings }); dirty = false;
    el('validation').textContent = ''; toPlugin('status');
  } catch (error) { el('validation').textContent = error.message; }
};
el('retry').onclick = () => toPlugin('retry');
el('acknowledge').onclick = () => toPlugin('acknowledge');
