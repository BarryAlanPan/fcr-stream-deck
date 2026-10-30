import { normalizeUrl } from './actions.mjs';
import { parsePage } from './parser.mjs';
import { request } from './http.mjs';

export class FcrClient {
  constructor(url, { transport = request, pollMs = 2000, retryMs = 5000, timeout = 8000 } = {}) {
    this.url = normalizeUrl(url);
    Object.assign(this, { transport, pollMs, retryMs, timeout });
    this.snapshot = null; this.healthy = false; this.busy = false;
    this.phase = 'reading'; this.warning = ''; this.error = '';
    this.listeners = new Set(); this.timer = null; this.reading = null;
    this.abort = new AbortController(); this.closed = false;
  }
  emit() { for (const listener of this.listeners) listener(this); }
  subscribe(listener) {
    this.listeners.add(listener); listener(this);
    if (this.listeners.size === 1) { this.healthy = false; void this.poll(); }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { clearTimeout(this.timer); this.timer = null; this.healthy = false; }
      // Preserve an in-flight command and its lock across profile switches.
    };
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.listeners.size && !this.closed) this.timer = setTimeout(() => void this.poll(), this.healthy ? this.pollMs : this.retryMs);
  }
  async read() {
    if (this.reading) return this.reading;
    this.reading = (async () => {
      try {
        const html = await this.transport('GET', this.url, '', undefined, { timeout: this.timeout, signal: this.abort.signal });
        this.snapshot = parsePage(html, this.url); this.healthy = true; this.error = '';
        return true;
      } catch (error) {
        this.healthy = false; this.error = error.message;
        return false;
      }
    })();
    try { return await this.reading; } finally { this.reading = null; }
  }
  async poll() {
    if (this.closed || ['sending', 'preparing'].includes(this.phase)) return false;
    clearTimeout(this.timer);
    const ok = await this.read();
    // A key press may have taken ownership while this background GET was pending.
    if (['preparing', 'sending'].includes(this.phase) || this.closed) return ok;
    if (ok) { this.busy = false; this.phase = 'ready'; }
    else this.phase = this.busy ? 'confirming' : 'offline';
    this.emit(); this.schedule(); return ok;
  }
  async command(name) {
    if (this.closed || this.busy || !this.healthy) return false;
    // Lock before awaiting, including across duplicate keys and different actions.
    this.busy = true; this.phase = 'preparing'; clearTimeout(this.timer); this.emit();
    if (this.reading) await this.reading;
    // Discover current GUIDs, labels and availability immediately before every POST.
    if (!await this.read()) {
      this.busy = false; this.phase = 'offline'; this.emit(); this.schedule(); return false;
    }
    let url, body, type = 'application/x-www-form-urlencoded';
    const recording = this.snapshot.actions.startrecord.active;
    if (name === 'startrecord' && recording) name = 'stop';
    const action = this.snapshot.actions[name];
    if (action && !action.disabled && !(name === 'play' && recording)) ({ url, body } = action);
    if (!url) { this.busy = false; this.phase = 'ready'; this.emit(); this.schedule(); return false; }
    this.phase = 'sending'; this.warning = ''; this.emit();
    try {
      await this.transport('POST', url, body, type, { timeout: this.timeout, signal: this.abort.signal });
    } catch (error) {
      this.warning = `Response not confirmed (${error.message}). Check FCR before repeating; the command may have run.`;
    }
    this.healthy = false; this.phase = 'confirming'; this.emit();
    // Never interpret a POST response as confirmed state. Failed reads retain the lock.
    await this.poll();
    return !this.warning;
  }
  acknowledge() { this.warning = ''; this.emit(); }
  close() {
    this.closed = true; clearTimeout(this.timer); this.abort.abort(); this.listeners.clear();
  }
}
