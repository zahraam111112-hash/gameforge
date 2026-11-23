// Thin WebSocket client. The server is authoritative for room state; this only
// ships local input and renders everyone else from server snapshots.

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null;
    this.peers = new Map();
    this.onMessage = null;
    this.onStatus = null;
    this.connected = false;
    this.seq = 0;
  }

  connect() {
    if (this.ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this._status('connected'); };
    ws.onclose = () => {
      this.connected = false; this._status('offline');
      this.ws = null;
      setTimeout(() => { if (!this.connected) this.connect(); }, 1500);
    };
    ws.onerror = () => this._status('error');
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') {
        this.id = msg.id;
        if (msg.room) this.room = msg.room;
        this._status('joined');
      } else if (msg.t === 'state') {
        // The server sends everyone on join and only changes after that, so
        // peers are merged, never replaced — a replace would erase the room.
        for (const p of msg.players ?? []) this.peers.set(p.id, p);
        for (const id of msg.gone ?? []) this.peers.delete(id);
        this.serverFrame = msg.frame;
        this.room = msg.room ?? this.room;
        this.winner = msg.winner ?? null;
      }
      this.onMessage?.(msg);
    };
  }

  join(mode, level = 'arena') {
    if (!this.ws || this.ws.readyState !== 1) { this.connect(); return; }
    this.ws.send(JSON.stringify({ t: 'join', mode, level, name: this.name ?? 'player' }));
  }

  setName(name) { this.name = name; if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'name', name })); }

  input(input) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.seq++;
    this.ws.send(JSON.stringify({ t: 'in', s: this.seq, ...input }));
  }

  _status(s) { this.status = s; this.onStatus?.(s); }

  get peerCount() { return this.peers.size; }
}
