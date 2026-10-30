export const PLUGIN_ID = 'com.local.fcr';
export const DEFAULT_URL = 'http://127.0.0.1:8085/';
export const ACTIONS = [
  ['startrecord', 'Record / Stop', 'Record', 'Start recording; press again to stop recording. FCR may open its save dialog.'],
  ['play', 'Play / Pause', 'Play', 'Play, pause, or resume using the current FCR action.'],
  ['replay', 'Replay Dial', 'Replay', 'Turn to seek (1% per tick). Press the dial or tap its display to start/stop replay.'],
  ['loadR', 'Load Replay', 'Load', 'Open FCR’s desktop recording picker.'],
  ['goStart', 'Go to Start', 'Start', 'Go to the start of the replay.'],
  ['backw', 'Backward', 'Back', 'Use FCR’s native backward action.'],
  ['forw', 'Forward', 'Forward', 'Use FCR’s native forward action.'],
  ['goEnd', 'Go to End', 'End', 'Go to the end of the replay.'],
  ['relive', 'ReLive', 'ReLive', 'Toggle ReLive.'],
  ['takeControl', 'Take Control', 'Control', 'Toggle Take Control.'],
  ['cameraCycle', 'CinematicR', 'Camera', 'Toggle CinematicR.'],
  ['ghost', 'Ghost', 'Ghost', 'Toggle Ghost.'],
].map(([id, name, title, description]) => ({ id, uuid: `${PLUGIN_ID}.${id.toLowerCase()}`, name, title, description }));
// FCR's page still contains these forms: Stop powers Record / Stop, and
// Connection and Refresh identify a valid page even without dedicated keys.
export const COMMANDS = new Set([...ACTIONS.filter(a => a.id !== 'replay').map(a => a.id), 'stop', 'connection', 'refresh']);
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
