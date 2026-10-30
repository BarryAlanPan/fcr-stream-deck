import { BY_UUID, normalizeUrl } from './actions.mjs';
import { FcrClient } from './client.mjs';
import { dialImage, keyImage, stateFor } from './render.mjs';
import { canSeek, stepPercent } from './replay.mjs';

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
    const dial = key.action.id === 'replay';
    const image = dial ? dialImage(key.client, key.pendingTicks, key.settings.stepPercent) : keyImage(stateFor(key.action, key.client));
    if (image !== key.image) {
      key.image = image;
      this.send(dial ? { event: 'setFeedback', context, payload: { replay: image } } :
        { event: 'setImage', context, payload: { image, target: 0 } });
    }
    if (key.inspector) this.status(context, key);
  }
  attach(event) {
    const action = BY_UUID.get(event.action);
    if (!action) return;
    const previous = this.keys.get(event.context);
    const key = { action, settings: event.payload?.settings || {}, inspector: previous?.inspector || false, pendingTicks: 0 };
    if (previous) this.cancelSeek(previous);
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
  cancelSeek(key) { clearTimeout(key.seekTimer); key.seekTimer = null; key.pendingTicks = 0; }
  rotate(context, key, ticks) {
    if (!Number.isSafeInteger(ticks) || !ticks) return;
    const client = key.client;
    if (!client || (!client.healthy && !(key.seeking && client.busy)) || client.warning ||
        !canSeek(client.snapshot) || (client.busy && !key.seeking)) {
      this.send({ event: 'showAlert', context }); return;
    }
    // Batch rapid turns and keep new ticks while this dial's own seek is in flight.
    const maxTicks = Math.ceil(100 / stepPercent(key.settings.stepPercent));
    key.pendingTicks = Math.max(-maxTicks, Math.min(maxTicks, key.pendingTicks + ticks));
    this.render(context, key);
    if (!key.seekTimer && !key.seeking) {
      key.seekTimer = setTimeout(() => void this.flushSeek(context, key), 120);
    }
  }
  async flushSeek(context, key) {
    key.seekTimer = null;
    if (this.keys.get(context) !== key || !key.pendingTicks) return;
    const ticks = key.pendingTicks; key.pendingTicks = 0; key.seeking = true;
    const ok = await key.client.command('seek', ticks, key.settings.stepPercent);
    key.seeking = false;
    if (this.keys.get(context) !== key) return;
    if (!ok || !key.client.healthy || key.client.busy || key.client.warning) {
      this.cancelSeek(key); this.send({ event: 'showAlert', context });
    } else if (key.pendingTicks) {
      key.seekTimer = setTimeout(() => void this.flushSeek(context, key), 120);
    }
    this.render(context, key);
  }
  async handle(event) {
    if (event.event === 'willAppear' || event.event === 'didReceiveSettings') { this.attach(event); return; }
    const key = this.keys.get(event.context);
    if (!key) return;
    if (event.event === 'willDisappear') { this.cancelSeek(key); key.unsubscribe?.(); this.keys.delete(event.context); return; }
    if (event.event === 'propertyInspectorDidAppear') { key.inspector = true; this.status(event.context, key); }
    if (event.event === 'propertyInspectorDidDisappear') key.inspector = false;
    if (event.event === 'sendToPlugin') {
      if (event.payload?.type === 'status') { key.inspector = true; this.status(event.context, key); }
      if (event.payload?.type === 'retry') await key.client?.poll();
      if (event.payload?.type === 'acknowledge') key.client?.acknowledge();
    }
    if (key.action.id === 'replay' && event.event === 'dialRotate') {
      this.rotate(event.context, key, event.payload?.ticks); return;
    }
    const dialClick = key.action.id === 'replay' && ['dialDown', 'touchTap'].includes(event.event);
    if (dialClick || (event.event === 'keyDown' && key.action.id !== 'replay')) {
      if (dialClick) this.cancelSeek(key);
      if (!key.client) { this.send({ event: 'showAlert', context: event.context }); return; }
      const ok = await key.client.command(key.action.id);
      if (!ok) this.send({ event: 'showAlert', context: event.context });
    }
  }
  close() {
    for (const key of this.keys.values()) this.cancelSeek(key);
    for (const client of this.clients.values()) client.close();
    this.keys.clear();
  }
}
