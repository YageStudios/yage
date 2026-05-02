import { FloatingWindow } from "./floatingwindow";
import { flags } from "./flags";

if (flags.PERFORMANCE_LOGS || flags.DRAW_PERFORMANCE_LOGS) {
  type TimingChannel = "perf" | "draw";
  type Timing = { type: string; time: number };
  type Row = {
    status: string;
    type: string;
    last: number;
    avg: number;
    p95: number;
    max: number;
    slowFrames: number;
    share: number;
  };
  type ChannelState = {
    history: { [key: string]: number[] };
    latest: Timing[];
    frame: number;
    total: number;
    button: HTMLButtonElement;
  };

  const BUDGET_MS = 4;
  const HISTORY_LIMIT = 240;
  const ROW_LIMIT = 20;
  const channelLabels: Record<TimingChannel, string> = {
    perf: "Perf",
    draw: "Draw",
  };

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const percentile = (values: number[], ratio: number) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
  };

  const performanceContainer = document.createElement("div");
  performanceContainer.style.color = "#111827";
  performanceContainer.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
  performanceContainer.style.fontSize = "12px";
  performanceContainer.style.lineHeight = "1.25";

  const title = document.createElement("div");
  title.textContent = "Performance Logs";
  title.style.fontSize = "16px";
  title.style.fontWeight = "700";
  title.style.marginBottom = "4px";

  const tabs = document.createElement("div");
  tabs.style.display = "flex";
  tabs.style.gap = "6px";
  tabs.style.margin = "6px 0 8px";

  const summary = document.createElement("div");
  summary.style.marginBottom = "8px";
  summary.style.color = "#334155";

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.tableLayout = "fixed";
  table.style.background = "#ffffff";
  table.style.color = "#111827";
  table.style.border = "1px solid #cbd5e1";

  const thead = document.createElement("thead");
  const header = document.createElement("tr");
  for (const [label, width] of [
    ["status", "46px"],
    ["system", "190px"],
    ["last", "52px"],
    ["avg", "52px"],
    ["p95", "52px"],
    ["max", "52px"],
    ["slow", "48px"],
    ["share", "48px"],
  ]) {
    const th = document.createElement("th");
    th.textContent = label;
    th.style.width = width;
    th.style.position = "sticky";
    th.style.top = "0";
    th.style.background = "#e2e8f0";
    th.style.color = "#111827";
    th.style.borderBottom = "1px solid #94a3b8";
    th.style.padding = "3px 4px";
    th.style.textAlign = label === "system" ? "left" : "right";
    header.appendChild(th);
  }
  thead.appendChild(header);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  performanceContainer.append(title, tabs, summary, table);
  const floater = new FloatingWindow(performanceContainer, 760, 420);
  floater.window.style.backgroundColor = "#f8fafc";
  floater.window.style.color = "#111827";

  let activeChannel: TimingChannel = flags.PERFORMANCE_LOGS ? "perf" : "draw";

  function cell(text: string, align: "left" | "right" = "right"): HTMLTableCellElement {
    const td = document.createElement("td");
    td.textContent = text;
    td.style.padding = "2px 4px";
    td.style.borderBottom = "1px solid #e2e8f0";
    td.style.whiteSpace = "nowrap";
    td.style.overflow = "hidden";
    td.style.textOverflow = "ellipsis";
    td.style.textAlign = align;
    return td;
  }

  function createTab(channel: TimingChannel): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.style.border = "1px solid #94a3b8";
    button.style.borderRadius = "4px";
    button.style.padding = "3px 8px";
    button.style.font = "inherit";
    button.style.cursor = "pointer";
    button.addEventListener("click", () => {
      activeChannel = channel;
      render();
    });
    tabs.appendChild(button);
    return button;
  }

  const channels: Record<TimingChannel, ChannelState> = {
    perf: {
      history: {},
      latest: [],
      frame: 0,
      total: 0,
      button: createTab("perf"),
    },
    draw: {
      history: {},
      latest: [],
      frame: 0,
      total: 0,
      button: createTab("draw"),
    },
  };

  function rowForTiming(channel: TimingChannel, timing: Timing, total: number): Row {
    const bucket = channels[channel].history[timing.type] ?? [];
    const sum = bucket.reduce((acc, val) => acc + val, 0);
    const p95 = percentile(bucket, 0.95);
    const max = Math.max(0, ...bucket);
    const slowFrames = bucket.filter((value) => value >= BUDGET_MS).length;
    return {
      status: slowFrames > 0 ? "SLOW" : "ok",
      type: timing.type,
      last: timing.time,
      avg: sum / Math.max(1, bucket.length),
      p95,
      max,
      slowFrames,
      share: timing.time / Math.max(0.001, total),
    };
  }

  function renderTabs() {
    (Object.keys(channels) as TimingChannel[]).forEach((channel) => {
      const state = channels[channel];
      state.button.textContent = `${channelLabels[channel]} ${round(state.total).toFixed(3)}ms`;
      state.button.style.background = channel === activeChannel ? "#0f172a" : "#ffffff";
      state.button.style.color = channel === activeChannel ? "#ffffff" : "#111827";
      state.button.style.fontWeight = channel === activeChannel ? "700" : "400";
      state.button.style.display = channel === "draw" && !flags.DRAW_PERFORMANCE_LOGS ? "none" : "inline-block";
    });
  }

  function render() {
    const state = channels[activeChannel];
    const rows = state.latest
      .map((timing) => rowForTiming(activeChannel, timing, state.total))
      .sort((a, b) => b.slowFrames - a.slowFrames || b.p95 - a.p95 || b.avg - a.avg)
      .slice(0, ROW_LIMIT);

    renderTabs();
    summary.textContent = `${channelLabels[activeChannel]} frame ${state.frame} | total ${round(state.total).toFixed(
      3
    )}ms | budget ${BUDGET_MS}ms | showing ${rows.length}/${state.latest.length}`;
    tbody.replaceChildren();

    for (const row of rows) {
      const tr = document.createElement("tr");
      if (row.status === "SLOW") tr.style.background = "#fee2e2";
      const statusCell = cell(row.status);
      statusCell.style.color = row.status === "SLOW" ? "#b91c1c" : "#166534";
      statusCell.style.fontWeight = "700";
      tr.append(
        statusCell,
        cell(row.type, "left"),
        cell(round(row.last).toFixed(3)),
        cell(round(row.avg).toFixed(3)),
        cell(round(row.p95).toFixed(3)),
        cell(round(row.max).toFixed(3)),
        cell(String(row.slowFrames)),
        cell(`${Math.round(row.share * 100)}%`)
      );
      tbody.appendChild(tr);
    }
  }

  // @ts-ignore
  window.performanceUpdate = (timings: Timing[], channel: TimingChannel = "perf") => {
    const state = channels[channel] ?? channels.perf;
    state.frame += 1;
    state.latest = timings;
    state.total = timings.reduce((acc, val) => acc + val.time, 0);
    for (const timing of timings) {
      if (!state.history[timing.type]) state.history[timing.type] = [];
      state.history[timing.type].push(timing.time);
      if (state.history[timing.type].length > HISTORY_LIMIT) state.history[timing.type].shift();
    }
    render();
  };

  render();
}
