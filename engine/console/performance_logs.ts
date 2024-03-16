import { FloatingWindow } from "./floatingwindow";
import { flags } from "./flags";

if (flags.PERFORMANCE_LOGS) {
  const performanceContainer = document.createElement("div");
  performanceContainer.innerHTML = `
    <h1>Performance Logs</h1>
    `;
  const floater = new FloatingWindow(performanceContainer);

  const performanceOverOneSecond: { [key: string]: number[] } = {};

  // @ts-ignore
  window.performanceUpdate = (timings: { type: string; time: number }[]) => {
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.border = "1px solid black";
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    const th1 = document.createElement("th");
    th1.innerText = "Type";
    const th2 = document.createElement("th");
    th2.innerText = "Time";
    const th3 = document.createElement("th");
    th3.innerText = "Average";
    tr.appendChild(th1);
    tr.appendChild(th2);
    tr.appendChild(th3);
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    timings
      .sort((timingA, timingB) => {
        if (performanceOverOneSecond[timingA.type] && performanceOverOneSecond[timingB.type]) {
          return (
            performanceOverOneSecond[timingB.type].reduce((acc, val) => acc + val, 0) -
            performanceOverOneSecond[timingA.type].reduce((acc, val) => acc + val, 0)
          );
        }
        return timingB.time - timingA.time;
      })
      .forEach((timing) => {
        if (!performanceOverOneSecond[timing.type]) performanceOverOneSecond[timing.type] = [];
        performanceOverOneSecond[timing.type].push(timing.time);
        if (performanceOverOneSecond[timing.type].length > 60) performanceOverOneSecond[timing.type].shift();
        const tr = document.createElement("tr");
        const td1 = document.createElement("td");
        td1.innerText = timing.type;
        const td2 = document.createElement("td");
        td2.innerText = timing.time.toFixed(2);
        const td3 = document.createElement("td");
        td3.innerText = performanceOverOneSecond[timing.type].reduce((acc, val) => acc + val, 0).toFixed(2);
        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tbody.appendChild(tr);
      });
    table.appendChild(tbody);
    const total = Math.round(timings.reduce((acc, val) => acc + val.time, 0) * 1000) / 1000;
    performanceContainer.innerHTML = `
    <h1>Performance Logs (${total})</h1>
    `;
    performanceContainer.appendChild(table);
  };
}
