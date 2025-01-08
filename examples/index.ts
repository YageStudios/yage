const games = [
  ["map", () => import("./map")],
  ["ball", () => import("./ball")],
  ["reba", () => import("./reball")],
  ["ui", () => import("./uimap")],
  ["peer", () => import("./peer")],
  ["socket", () => import("./socket")],
] as const;

let found = false;
for (const game of games) {
  if (window.location.hash?.includes(game[0])) {
    found = true;
    game[1]();
  }
}

if (!found) {
  document.body.innerHTML = `
  <div style="background-color: #333; padding: 20px; height: calc(100svh - 40px); font-size: 32px">
    <h1 style="color: white">Tests</h1>
    ${games.map((game) => `<br/><a href="?${+new Date()}#${game[0]}">${game[0]}</a>`).join("")}
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
