// Tiny synchronous event bus decoupling systems (audio ← ai ← game ← ui).
// Also mirrors events over BroadcastChannel so a multi-projector (?surface=)
// setup driven by one machine can stay in lockstep (leader broadcasts).

export class EventBus {
  constructor(channelName = 'ubicuity-cube-horror') {
    this.map = new Map();
    this.chan = null;
    try { this.chan = new BroadcastChannel(channelName); } catch { this.chan = null; }
    if (this.chan) this.chan.onmessage = (e) => this._dispatch(e.data.type, e.data.payload, true);
  }
  on(type, cb) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(cb);
    return () => this.map.get(type)?.delete(cb);
  }
  emit(type, payload, { broadcast = false } = {}) {
    this._dispatch(type, payload, false);
    if (broadcast && this.chan) { try { this.chan.postMessage({ type, payload }); } catch {} }
  }
  _dispatch(type, payload, remote) {
    const set = this.map.get(type);
    if (set) for (const cb of set) cb(payload, remote);
  }
}
