const games = [
  ["map", () => import("./map")],
  ["ball", () => import("./ball")],
  ["reba", () => import("./reball")],
  ["ui", () => import("./uimap")],
  ["peer", () => import("./peer")],
  ["socket", () => import("./socket")],
  ["tictactoe", () => import("./tictactoe")],
  ["tetris", () => import("./tetris")],
  ["pong", () => import("./pong")],
  ["snake", () => import("./snake")],
  ["breakout", () => import("./breakout")],
  ["asteroids", () => import("./asteroids")],
  ["platformer", () => import("./platformer")],
  ["sokoban", () => import("./sokoban")],
] as const;

const GAME_NAMES = new Set(games.map(([name]) => name));
const buildStamp = Date.now();

const normalizeBasePath = (basePath: string) => {
  if (!basePath || basePath === "/") {
    return "/";
  }
  return `/${basePath.replace(/^\/+|\/+$/g, "")}/`;
};

const getGameFromPath = () => {
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);
  const pathname = window.location.pathname;
  const relativePath = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.replace(/^\/+/, "");
  const [firstSegment = ""] = relativePath.split("/").filter(Boolean);
  return GAME_NAMES.has(firstSegment as (typeof games)[number][0]) ? firstSegment : null;
};

const activeGame = getGameFromPath();
const selectedGame = games.find(([name]) => name === activeGame);

if (selectedGame) {
  selectedGame[1]();
} else {
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);
  document.body.innerHTML = `
  <div style="background-color: #333; padding: 20px; height: calc(100svh - 40px); font-size: 32px">
    <h1 style="color: white">Tests</h1>
    ${games
      .map(([name]) => `<br/><a href="${basePath}${name}?t=${buildStamp}">${name}</a>`)
      .join("")}
  </div> 
  `;
}

// if (window.location.hash?.includes("ball")) {
//   (() => {
//     import("./ball");
//   })();
// } else if (window.location.hash?.includes("ui")) {
//   (() => {
//     import("./ui");
//   })();
// }
// else {
//   document.body.innerHTML = `
//   <div style="background-color: #333; padding: 20px; height: calc(100svh - 40px); font-size: 32px">
//     <h1 style="color: white">Tests</h1>
//     <a href="?${+new Date()}#ball">Ball</a>
//   </div>
//   `;
// }
