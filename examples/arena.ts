// Four-player arena: four iframes, each an independent player peer running
// the same lockstep game over the socket transport. Click an arena to claim
// a side from the AI — every other iframe sees the takeover on the same
// simulation frame. Requires the game server: `npm run server`.
const room = new URLSearchParams(window.location.search).get("room") ?? "arena";

document.title = "YAGE Arena";
document.body.style.cssText = "margin:0;background:#05070c;color:#dfe6f3;font:14px monospace;overflow:hidden";

// Collect uncaught errors from the host page and every peer iframe so an
// automated harness can assert on a clean boot (consoles are per-iframe and
// not reachable retroactively).
const bootErrors: string[] = [];
(window as any).__BRICKUP_ERRORS__ = bootErrors;
const recordError = (prefix: string, args: any[]) => {
  bootErrors.push(`${prefix} ${args.map((arg) => String(arg?.stack ?? arg)).join(" ").slice(0, 300)}`);
  if (bootErrors.length > 100) bootErrors.shift();
};
window.addEventListener("error", (e) => recordError("[host]", [(e as any).error?.stack ?? e.message]));
window.addEventListener("unhandledrejection", (e) =>
  recordError("[host]", [(e as any).reason?.stack ?? (e as any).reason])
);
const forwardFrameErrors = (frame: HTMLIFrameElement, label: string) => {
  const win = frame.contentWindow;
  if (!win) return;
  win.addEventListener("error", (e) => recordError(`[${label}]`, [(e as any).error?.stack ?? e.message]));
  win.addEventListener("unhandledrejection", (e) =>
    recordError(`[${label}]`, [(e as any).reason?.stack ?? (e as any).reason])
  );
};

const grid = document.createElement("div");
// Above the engine shell's full-viewport #interaction input layer (z-index 2),
// so user clicks land in the peer iframes instead of the empty host page.
grid.style.cssText =
  "position:absolute;inset:44px 8px 8px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8px;z-index:10";

const note = document.createElement("div");
note.textContent = `ARENA ${room} — run "npm run server", then click an arena to take over a side from the AI`;
note.style.cssText =
  "position:absolute;top:12px;left:16px;font-size:13px;color:#8a94a8";
document.body.appendChild(note);

// Chained mounts: each player boots only after the previous one signals it
// has joined the room, so one host is elected and the rest join it. Booting
// them in parallel races the host election into parallel rooms.
const players = ["player1", "player2", "player3", "player4"];
const frames: HTMLIFrameElement[] = [];

const waitRoomJoined = (frame: HTMLIFrameElement) =>
  new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (frame.contentWindow?.__BRICKUP_ROOM_JOINED__) {
        resolve();
      } else if (Date.now() - started > 30000) {
        reject(new Error("peer room join timed out"));
      } else {
        setTimeout(poll, 200);
      }
    };
    poll();
  });

(async () => {
  for (let index = 0; index < players.length; index++) {
    if (index > 0) {
      try {
        await waitRoomJoined(frames[index - 1]);
      } catch (e) {
        note.textContent = `ARENA ${room} — peer failed to join: ${e.message}`;
      }
    }
    const frame = document.createElement("iframe");
    frame.src = `brickup?socket=true&player=${players[index]}&room=${room}`;
    frame.style.cssText = "width:100%;height:100%;border:1px solid #26324a;border-radius:6px;background:#000";
    grid.appendChild(frame);
    frames.push(frame);
    frame.addEventListener("load", () => forwardFrameErrors(frame, players[index]));
  }
  // A late join can succeed long after a chained-mount timeout fired, so the
  // failure banner must not outlive the actual room state.
  const joinedNote = setInterval(() => {
    if (frames.every((frame) => frame.contentWindow?.__BRICKUP_ROOM_JOINED__)) {
      note.textContent = `ARENA ${room} — 4 players in room · click an arena to take over a side`;
      clearInterval(joinedNote);
    }
  }, 500);
})();
document.body.appendChild(grid);
