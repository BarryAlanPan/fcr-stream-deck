import { BY_UUID, normalizeUrl } from './actions.mjs';
import { FcrClient } from './client.mjs';
import { keyImage, stateFor } from './render.mjs';

export class DeckController {
  constructor(send, createClient = url => new FcrClient(url)) {
    this.send = send; this.createClient = createClient;
    this.keys = new Map(); this.clients = new Map();
  }
  status(context, key) {
    const c = key.client;
    this.send({ event: 'sendToPropertyInspector', action: key.action.uuid, context, payload: {
      phase: c?.phase || 'configuration', healthy: !!c?.healthy, busy: !!c?.busy,
      status: c?.snapshot?.status || '', warning: c?.warning || '',
      error: key.error || c?.error || '', url: c?.url || '',
    } });
  }
  render(context, key) {
    const image = keyImage(stateFor(key.action, key.client));
    if (image !== key.image) { key.image = image; this.send({ event: 'setImage', context, payload: { image, target: 0 } }); }
    if (key.inspector) this.status(context, key);
  }
  attach(event) {
    const action = BY_UUID.get(event.action);
    if (!action) return;
    const previous = this.keys.get(event.context);
    const key = { action, settings: event.payload?.settings || {}, inspector: previous?.inspector || false };
    try {
      const url = normalizeUrl(key.settings.serverUrl);
      if (!this.clients.has(url)) this.clients.set(url, this.createClient(url));
      key.client = this.clients.get(url);
    } catch (error) { key.error = error.message; }
    // Subscribe the new instance before releasing the old one.
    this.keys.set(event.context, key);
    if (key.client) key.unsubscribe = key.client.subscribe(() => this.render(event.context, key));
    else this.render(event.context, key);
    previous?.unsubscribe?.();
  }
  async handle(event) {
    if (event.event === 'willAppear' || event.event === 'didReceiveSettings') { this.attach(event); return; }
    const key = this.keys.get(event.context);
    if (!key) return;
    if (event.event === 'willDisappear') { key.unsubscribe?.(); this.keys.delete(event.context); return; }
    if (event.event === 'propertyInspectorDidAppear') { key.inspector = true; this.status(event.context, key); }
    if (event.event === 'propertyInspectorDidDisappear') key.inspector = false;
    if (event.event === 'sendToPlugin') {
      if (event.payload?.type === 'status') { key.inspector = true; this.status(event.context, key); }
      if (event.payload?.type === 'retry') await key.client?.poll();
      if (event.payload?.type === 'acknowledge') key.client?.acknowledge();
    }
    if (event.event === 'keyDown') {
      if (!key.client) { this.send({ event: 'showAlert', context: event.context }); return; }
      const ok = await key.client.command(key.action.id);
      if (!ok) this.send({ event: 'showAlert', context: event.context });
    }
  }
  close() { for (const client of this.clients.values()) client.close(); this.keys.clear(); }
}
