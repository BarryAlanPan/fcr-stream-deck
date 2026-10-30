export const PLUGIN_ID = 'com.local.fcr';
export const DEFAULT_URL = 'http://127.0.0.1:8085/';
export const ACTIONS = [
  ['connection', 'Connection', 'Connect', 'Connect or disconnect the simulator.'],
  ['startrecord', 'Record / Stop', 'Record', 'Start recording; press again to stop recording. FCR may open its save dialog.'],
  ['play', 'Play / Pause', 'Play', 'Play, pause, or resume using the current FCR action.'],
  ['stop', 'Stop', 'Stop', 'Stop playback or recording. FCR may open its save dialog.'],
  ['loadR', 'Load Replay', 'Load', 'Open FCR’s desktop recording picker.'],
  ['goStart', 'Go to Start', 'Start', 'Go to the start of the replay.'],
  ['backw', 'Backward', 'Back', 'Use FCR’s native backward action.'],
  ['forw', 'Forward', 'Forward', 'Use FCR’s native forward action.'],
  ['goEnd', 'Go to End', 'End', 'Go to the end of the replay.'],
  ['relive', 'ReLive', 'ReLive', 'Toggle ReLive.'],
  ['takeControl', 'Take Control', 'Control', 'Toggle Take Control.'],
  ['cameraCycle', 'CinematicR', 'Camera', 'Toggle CinematicR.'],
  ['ghost', 'Ghost', 'Ghost', 'Toggle Ghost.'],
  ['refresh', 'Refresh FCR', 'Refresh', 'Invoke FCR’s native Refresh command.'],
  ['seek', 'Seek to Position', 'Seek', 'Jump to a configured percentage of the replay.'],
  ['status', 'Status / Retry', 'FCR', 'Show FCR status; press to retry a status read. Sends no control command.'],
].map(([id, name, title, description]) => ({ id, uuid: `${PLUGIN_ID}.${id.toLowerCase()}`, name, title, description }));
export const COMMANDS = new Set(ACTIONS.map(a => a.id).filter(id => !['seek', 'status'].includes(id)));
export const BY_UUID = new Map(ACTIONS.map(a => [a.uuid, a]));

export function normalizeUrl(value = DEFAULT_URL) {
  const url = new URL(value || DEFAULT_URL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a local FCR server URL, e.g. http://127.0.0.1:8085/');
  }
  // Localhost and IPv4 aliases must share one command lock.
  url.hostname = '127.0.0.1';
  return url.href;
}

export function seekPercent(settings = {}) {
  const value = settings.position ?? 50;
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}
