import WebSocket from 'ws';
import { DeckController } from './controller.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('-port')), uuid = option('-pluginUUID'), event = option('-registerEvent');
if (!Number.isInteger(port) || port < 1 || port > 65535 || !uuid || event !== 'registerPlugin') {
  console.error('This plugin is launched by Stream Deck. Install the .streamDeckPlugin package.');
  process.exit(1);
}
const socket = new WebSocket(`ws://127.0.0.1:${port}`);
const send = message => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
const controller = new DeckController(send);
socket.on('open', () => send({ event, uuid }));
socket.on('message', data => {
  try { void controller.handle(JSON.parse(data.toString())).catch(error => console.error(error.message)); }
  catch (error) { console.error('Invalid Stream Deck event:', error.message); }
});
socket.on('error', error => console.error('Stream Deck connection:', error.message));
socket.on('close', () => { controller.close(); process.exit(0); });
process.on('SIGTERM', () => { controller.close(); socket.close(); });
process.on('SIGINT', () => { controller.close(); socket.close(); });
