import { util } from "peerjs";

/**
 * Serverless WebRTC for PeerMultiplayerInstance: two devices swap one short code each (by QR or typing) instead of
 * talking to a PeerJS signaling server, so play works on a hotspot or LAN with no internet. The codes carry only what
 * a data-channel SDP needs (ICE credentials, DTLS fingerprint, candidates); each side rebuilds a full SDP from them.
 *
 * Flow: host `ManualLink.offer()` → joiner `ManualLink.answer(offerCode)` → host `link.accept(answerCode)`.
 * Both links then resolve `opened` and hand a `ManualPeer` to PeerMultiplayerInstance through its `peerFactory`.
 */

const VERSION = "Y1";
const SCTP_PORT = 5000;
/** Gathering normally finishes in well under a second on a LAN; never let a stray interface stall the code. */
const GATHER_TIMEOUT_MS = 2500;
const MAX_CANDIDATES = 6;

export interface ManualSignal {
  kind: "offer" | "answer";
  peerId: string;
  ufrag: string;
  pwd: string;
  /** SHA-256 DTLS fingerprint bytes. */
  fingerprint: Uint8Array;
  setup: "actpass" | "active" | "passive";
  mid: string;
  candidates: { address: string; port: number; type: "host" | "srflx" }[];
}

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const SETUP = { actpass: "c", active: "a", passive: "p" } as const;
const FIELD = /^[A-Za-z0-9+/=._-]+$/;

export function encodeSignal(signal: ManualSignal): string {
  const candidates = signal.candidates
    .map((c) => (c.type === "srflx" ? "s" : "") + c.address + "_" + c.port)
    .join("~");
  return [VERSION, signal.kind === "offer" ? "o" : "a", signal.peerId, signal.ufrag, signal.pwd, b64u(signal.fingerprint),
    SETUP[signal.setup], signal.mid, candidates].join("*");
}

/** Accepts the bare code or any text that contains it (a scanned invite URL, for example). */
export function decodeSignal(text: string): ManualSignal {
  const start = text.indexOf(VERSION + "*");
  if (start < 0) throw new Error("That is not a game connection code.");
  const parts = decodeURIComponent(text.slice(start)).split(/[\s#&]/)[0].split("*");
  if (parts.length !== 9) throw new Error("That connection code is incomplete.");
  const [, kind, peerId, ufrag, pwd, fp, setup, mid, list] = parts;
  if (kind !== "o" && kind !== "a") throw new Error("That connection code is incomplete.");
  if (![peerId, ufrag, pwd, fp, mid].every((field) => FIELD.test(field))) throw new Error("That connection code is damaged.");
  const fingerprint = unb64u(fp);
  if (fingerprint.length !== 32) throw new Error("That connection code is damaged.");
  const role = (Object.keys(SETUP) as (keyof typeof SETUP)[]).find((key) => SETUP[key] === setup);
  if (!role) throw new Error("That connection code is damaged.");
  const candidates = list ? list.split("~").map((entry) => {
    const srflx = entry.startsWith("s");
    const body = srflx ? entry.slice(1) : entry;
    const cut = body.lastIndexOf("_");
    const address = body.slice(0, cut), port = Number(body.slice(cut + 1));
    if (cut < 1 || !/^[0-9A-Fa-f:.a-z-]+$/.test(address) || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("That connection code is damaged.");
    return { address, port, type: srflx ? "srflx" as const : "host" as const };
  }) : [];
  return { kind: kind === "o" ? "offer" : "answer", peerId, ufrag, pwd, fingerprint, setup: role, mid, candidates };
}

/** Reads the parts of a browser-made SDP that the compact code keeps. */
export function signalFromSdp(kind: ManualSignal["kind"], peerId: string, sdp: string): ManualSignal {
  const line = (name: string) => sdp.match(new RegExp("^a=" + name + ":(.+)$", "m"))?.[1].trim();
  const ufrag = line("ice-ufrag"), pwd = line("ice-pwd"), fp = line("fingerprint"), setup = line("setup"), mid = line("mid") ?? "0";
  if (!ufrag || !pwd || !fp || !setup) throw new Error("This browser produced an unusable connection offer.");
  const [algorithm, hex] = fp.split(" ");
  if (algorithm.toLowerCase() !== "sha-256") throw new Error("This browser uses an unsupported connection fingerprint.");
  const fingerprint = Uint8Array.from(hex.split(":"), (byte) => parseInt(byte, 16));
  const seen = new Set<string>();
  const candidates: ManualSignal["candidates"] = [];
  for (const [, body] of sdp.matchAll(/^a=candidate:(.+)$/gm)) {
    const f = body.trim().split(/\s+/);
    // foundation component transport priority address port "typ" type …
    if (f[1] !== "1" || f[2].toLowerCase() !== "udp" || (f[7] !== "host" && f[7] !== "srflx")) continue;
    const key = f[4] + "_" + f[5];
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ address: f[4], port: Number(f[5]), type: f[7] });
  }
  // IPv4 first: phone hotspots and plane Wi-Fi hand out IPv4; IPv6 is usually link-local only.
  candidates.sort((a, b) => Number(a.address.includes(":")) - Number(b.address.includes(":")));
  return { kind, peerId, ufrag, pwd, fingerprint, setup: setup as ManualSignal["setup"], mid, candidates: candidates.slice(0, MAX_CANDIDATES) };
}

export function sdpFromSignal(signal: ManualSignal): string {
  const fingerprint = Array.from(signal.fingerprint, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const candidates = signal.candidates.map((c, i) =>
    `a=candidate:${i + 1} 1 udp ${(c.type === "host" ? 2122260223 : 1686052607) - i} ${c.address} ${c.port} typ ${c.type}` +
    (c.type === "srflx" ? " raddr 0.0.0.0 rport 0" : "") + " generation 0");
  return [
    "v=0",
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${signal.mid}`,
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...candidates,
    "a=end-of-candidates",
    `a=ice-ufrag:${signal.ufrag}`,
    `a=ice-pwd:${signal.pwd}`,
    `a=fingerprint:sha-256 ${fingerprint}`,
    `a=setup:${signal.setup}`,
    `a=mid:${signal.mid}`,
    `a=sctp-port:${SCTP_PORT}`,
    "a=max-message-size:262144",
    "",
  ].join("\r\n");
}

async function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

type Listener = (...args: any[]) => void;
class Emitter {
  private listeners: Record<string, { fn: Listener; once: boolean }[]> = {};
  on(event: string, fn: Listener) {
    (this.listeners[event] ??= []).push({ fn, once: false });
    return this;
  }
  once(event: string, fn: Listener) {
    (this.listeners[event] ??= []).push({ fn, once: true });
    return this;
  }
  off(event: string, fn?: Listener) {
    this.listeners[event] = fn ? (this.listeners[event] ?? []).filter((l) => l.fn !== fn) : [];
    return this;
  }
  protected emit(event: string, ...args: any[]) {
    const list = this.listeners[event] ?? [];
    this.listeners[event] = list.filter((l) => !l.once);
    for (const l of list) l.fn(...args);
  }
  protected listenerCount(event: string) {
    return this.listeners[event]?.length ?? 0;
  }
}

type Chunk = { __peerData: number; n: number; total: number; data: ArrayBuffer };

/**
 * The DataConnection surface PeerMultiplayerInstance uses, over a raw RTCDataChannel, with PeerJS's own BinaryPack
 * framing and 16 KB chunking so messages behave exactly as they do through PeerJS. The channel is already open when
 * the game attaches, so `open` fires for late listeners and data received before the first listener is held.
 */
export class ManualConnection extends Emitter {
  open = false;
  private closed = false;
  private announced = false;
  private announcing = false;
  private pending: unknown[] = [];
  private outbox: ArrayBuffer[] = [];
  private chunks: Record<number, { data: Uint8Array[]; count: number; total: number }> = {};
  private chunkId = 1;

  constructor(readonly peer: string, readonly peerConnection: RTCPeerConnection, readonly channel: RTCDataChannel) {
    super();
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 1 << 20;
    channel.addEventListener("bufferedamountlow", () => this.flush());
    channel.addEventListener("message", (event) => this.receive(event.data as ArrayBuffer));
    channel.addEventListener("close", () => this.close());
    peerConnection.addEventListener("iceconnectionstatechange", () => {
      this.emit("iceStateChanged", peerConnection.iceConnectionState);
      if (peerConnection.iceConnectionState === "failed" || peerConnection.iceConnectionState === "closed") this.close();
    });
    if (channel.readyState === "open") this.open = true;
    else channel.addEventListener("open", () => {
      this.open = true;
      this.announce();
    }, { once: true });
  }

  override on(event: string, fn: Listener) {
    if (event === "open" && this.announced) queueMicrotask(() => fn());
    else super.on(event, fn);
    this.scheduleAnnounce(event);
    return this;
  }

  override once(event: string, fn: Listener) {
    if (event === "open" && this.announced) queueMicrotask(() => fn());
    else super.once(event, fn);
    this.scheduleAnnounce(event);
    return this;
  }

  /** The channel was open before anyone listened: report it once the current listeners have attached. */
  private scheduleAnnounce(event: string) {
    if ((event === "open" || event === "data") && this.open && !this.announced && !this.announcing) {
      this.announcing = true;
      queueMicrotask(() => this.announce());
    }
  }

  /**
   * PeerJS always reports `open` before any data, and PeerMultiplayerInstance relies on it: data from a peer it has not
   * seen open makes it attach the connection a second time. Data waits until `open` has reached the listeners.
   */
  private announce() {
    if (this.closed || this.announced) return;
    this.announced = true;
    this.emit("open");
    const held = this.pending;
    this.pending = [];
    held.forEach((data) => this.emit("data", data));
  }

  send(data: unknown) {
    if (this.closed) return;
    const packed = util.pack(data as any);
    if (packed instanceof Promise) void packed.then((buffer) => this.sendPacked(buffer as ArrayBuffer));
    else this.sendPacked(packed);
  }

  private sendPacked(buffer: ArrayBuffer) {
    if (buffer.byteLength <= util.chunkedMTU) {
      this.queue(buffer);
      return;
    }
    const total = Math.ceil(buffer.byteLength / util.chunkedMTU);
    const id = this.chunkId++;
    for (let n = 0; n < total; n++) {
      const chunk: Chunk = { __peerData: id, n, total, data: buffer.slice(n * util.chunkedMTU, (n + 1) * util.chunkedMTU) };
      this.queue(util.pack(chunk as any) as ArrayBuffer);
    }
  }

  private queue(buffer: ArrayBuffer) {
    this.outbox.push(buffer);
    this.flush();
  }

  private flush() {
    while (this.outbox.length && this.channel.readyState === "open" && this.channel.bufferedAmount < 8 << 20) {
      this.channel.send(this.outbox.shift()!);
    }
  }

  private receive(buffer: ArrayBuffer) {
    const data = util.unpack(buffer) as any;
    if (data && typeof data === "object" && typeof data.__peerData === "number") {
      const entry = (this.chunks[data.__peerData] ??= { data: [], count: 0, total: data.total });
      entry.data[data.n] = new Uint8Array(data.data);
      if (++entry.count < entry.total) return;
      delete this.chunks[data.__peerData];
      const whole = new Uint8Array(entry.data.reduce((size, part) => size + part.byteLength, 0));
      let offset = 0;
      for (const part of entry.data) {
        whole.set(part, offset);
        offset += part.byteLength;
      }
      this.receive(whole.buffer);
      return;
    }
    if (this.announced && this.listenerCount("data")) this.emit("data", data);
    else this.pending.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    try { this.channel.close(); } catch { /* already closed */ }
    try { this.peerConnection.close(); } catch { /* already closed */ }
    this.emit("close");
  }
}

class UnreachableConnection extends Emitter {
  open = false;
  constructor(readonly peer: string) {
    super();
  }
  send() {}
  close() {}
}

/**
 * Stands in for a PeerJS `Peer`: opens immediately under a fixed id, returns the swapped connection from `connect`,
 * and announces it as an incoming `connection` to a host whose room is already running.
 */
export class ManualPeer extends Emitter {
  destroyed = false;
  private connection: ManualConnection | null = null;

  constructor(readonly id: string) {
    super();
  }

  override on(event: string, fn: Listener) {
    super.on(event, fn);
    if (event === "open") queueMicrotask(() => { if (!this.destroyed) fn(this.id); });
    return this;
  }

  /** Host side: a joiner finished the code swap. */
  accept(connection: ManualConnection) {
    this.connection = connection;
    this.emit("connection", connection);
  }

  /** Joiner side: the link to the host, made before the game started. */
  attach(connection: ManualConnection) {
    this.connection = connection;
  }

  connect(peerId: string): ManualConnection | UnreachableConnection {
    if (this.connection?.peer === peerId) return this.connection;
    // Rooms without a signaling server are host + one guest: any other id (PeerMultiplayerInstance also dials its own
    // id once) gets a connection that never opens, as an unreachable peer does under PeerJS.
    return new UnreachableConnection(peerId);
  }

  destroy() {
    this.destroyed = true;
    this.connection?.close();
  }
}

/** One side of a code swap. */
export class ManualLink {
  readonly opened: Promise<ManualConnection>;
  private resolveOpen!: (connection: ManualConnection) => void;
  private rejectOpen!: (error: Error) => void;
  private channel: RTCDataChannel;

  private constructor(readonly peerId: string, readonly pc: RTCPeerConnection, public remotePeerId = "") {
    this.opened = new Promise((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    void this.opened.catch(() => {});
    // Negotiated channel 0: both sides create it, so no in-band channel announcement is needed.
    this.channel = pc.createDataChannel("yage", { negotiated: true, id: 0, ordered: true });
    this.channel.addEventListener("open", () => this.resolveOpen(new ManualConnection(this.remotePeerId, pc, this.channel)), { once: true });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc.iceConnectionState === "failed")
        this.rejectOpen(new Error("The devices could not reach each other. Check both are on the same Wi-Fi or hotspot."));
    });
  }

  private static create(): RTCPeerConnection {
    if (typeof RTCPeerConnection === "undefined") throw new Error("This browser cannot make direct connections.");
    // No STUN/TURN: offline play only needs host candidates on the shared network.
    return new RTCPeerConnection({ iceServers: [] });
  }

  /** Host: make the first code. */
  static async offer(peerId: string): Promise<{ link: ManualLink; code: string }> {
    const link = new ManualLink(peerId, ManualLink.create());
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await gathered(link.pc);
    return { link, code: encodeSignal(signalFromSdp("offer", peerId, link.pc.localDescription!.sdp)) };
  }

  /** Joiner: answer the host's code. */
  static async answer(peerId: string, offerCode: string): Promise<{ link: ManualLink; code: string }> {
    const offer = decodeSignal(offerCode);
    if (offer.kind !== "offer") throw new Error("Scan the host's code first.");
    const link = new ManualLink(peerId, ManualLink.create(), offer.peerId);
    await link.pc.setRemoteDescription({ type: "offer", sdp: sdpFromSignal(offer) });
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await gathered(link.pc);
    return { link, code: encodeSignal(signalFromSdp("answer", peerId, link.pc.localDescription!.sdp)) };
  }

  /** Host: finish with the joiner's code. */
  async accept(answerCode: string): Promise<ManualConnection> {
    const answer = decodeSignal(answerCode);
    if (answer.kind !== "answer") throw new Error("That is a host code. Scan the code on your friend's screen.");
    this.remotePeerId = answer.peerId;
    await this.pc.setRemoteDescription({ type: "answer", sdp: sdpFromSignal(answer) });
    return this.opened;
  }

  close() {
    this.rejectOpen(new Error("Cancelled."));
    this.pc.close();
  }
}
