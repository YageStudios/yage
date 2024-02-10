if (window.location.hash?.includes("ball")) {
  import("./ball");
} else {
  document.body.innerHTML = `
  <div style="background-color: #333; padding: 20px; height: calc(100svh - 40px); font-size: 32px">
    <h1 style="color: white">Tests</h1>
    <a href="?${+new Date()}#ball">Ball</a>
  </div>
  `;
}
