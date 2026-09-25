import { FloatingWindow } from "./floatingwindow";
import { flags } from "./flags";

if (flags.PERFORMANCE_LOGS || flags.DRAW_PERFORMANCE_LOGS) {
  type TimingChannel = "perf" | "draw";
  type SortMode = "live" | "average";
  type Timing = { type: string; time: number };
  type Row = {
    status: string;
    type: string;
    disabled: boolean;
    live: number;
    avg: number;
    p95: number;
    max: number;
    slowFrames: number;
    share: number;
  };
  type ChannelState = {
    history: { [key: string]: number[] };
    live: { [key: string]: number };
    knownTypes: Set<string>;
    latestCount: number;
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

  const disabledDrawSystems = new Set<string>();
  const drawSystemEnabled = (systemName: string) => !disabledDrawSystems.has(systemName);
  const setDrawSystemEnabled = (systemName: string, enabled: boolean) => {
    if (enabled) {
      disabledDrawSystems.delete(systemName);
    } else {
      disabledDrawSystems.add(systemName);
    }
  };

  const performanceWindow = window as Window & {
    yageDrawSystemEnabled?: (systemName: string) => boolean;
    yageSetDrawSystemEnabled?: (systemName: string, enabled: boolean) => void;
    yageDisabledDrawSystems?: Set<string>;
  };
  performanceWindow.yageDrawSystemEnabled = drawSystemEnabled;
  performanceWindow.yageSetDrawSystemEnabled = setDrawSystemEnabled;
  performanceWindow.yageDisabledDrawSystems = disabledDrawSystems;

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

  const sortControls = document.createElement("div");
  sortControls.style.display = "flex";
  sortControls.style.gap = "6px";
  sortControls.style.margin = "0 0 8px";

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
  thead.appendChild(header);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  performanceContainer.append(title, tabs, sortControls, summary, table);
  const floater = new FloatingWindow(performanceContainer, 760, 420);
  floater.window.style.backgroundColor = "#f8fafc";
  floater.window.style.color = "#111827";

  let activeChannel: TimingChannel = flags.PERFORMANCE_LOGS ? "perf" : "draw";
  let sortMode: SortMode = "live";

  const columnsForActiveChannel = (): [string, string][] => [
    ...(activeChannel === "draw" ? ([["draw", "34px"]] as [string, string][]) : []),
    ["status", "46px"],
    ["system", activeChannel === "draw" ? "166px" : "190px"],
    ["live", "52px"],
    ["avg", "52px"],
    ["p95", "52px"],
    ["max", "52px"],
    ["slow", "48px"],
    ["share", "48px"],
  ];

  const renderHeader = () => {
    header.replaceChildren();
    for (const [label, width] of columnsForActiveChannel()) {
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
  }

  const cell = (text: string, align: "left" | "right" = "right"): HTMLTableCellElement => {
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

  const drawToggleCell = (row: Row): HTMLTableCellElement => {
    const td = cell("");
    td.style.textAlign = "center";
    if (activeChannel !== "draw") {
      return td;
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !row.disabled;
    checkbox.title = checkbox.checked ? `Disable ${row.type}` : `Enable ${row.type}`;
    checkbox.setAttribute("aria-label", `${checkbox.checked ? "Disable" : "Enable"} ${row.type}`);
    checkbox.style.margin = "0";
    checkbox.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDrawSystemEnabled(row.type, row.disabled);
      render();
    });
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    checkbox.addEventListener("change", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDrawSystemEnabled(row.type, checkbox.checked);
      render();
    });
    td.appendChild(checkbox);
    return td;
  }

  const createTab = (channel: TimingChannel): HTMLButtonElement => {
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

  const createSortButton = (mode: SortMode, label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.border = "1px solid #94a3b8";
    button.style.borderRadius = "4px";
    button.style.padding = "3px 8px";
    button.style.font = "inherit";
    button.style.cursor = "pointer";
    button.addEventListener("click", () => {
      sortMode = mode;
      render();
    });
    sortControls.appendChild(button);
    return button;
  }

  const sortButtons: Record<SortMode, HTMLButtonElement> = {
    live: createSortButton("live", "Live Sort"),
    average: createSortButton("average", "Average Sort"),
  };

  const channels: Record<TimingChannel, ChannelState> = {
    perf: {
      history: {},
      live: {},
      knownTypes: new Set(),
      latestCount: 0,
      frame: 0,
      total: 0,
      button: createTab("perf"),
    },
    draw: {
      history: {},
      live: {},
      knownTypes: new Set(),
      latestCount: 0,
      frame: 0,
      total: 0,
      button: createTab("draw"),
    },
  };

  const pushHistory = (state: ChannelState, type: string, time: number): void => {
    if (!state.history[type]) state.history[type] = [];
    state.history[type].push(time);
    if (state.history[type].length > HISTORY_LIMIT) state.history[type].shift();
  }

  const rowForType = (channel: TimingChannel, type: string, total: number): Row => {
    const state = channels[channel];
    const bucket = state.history[type] ?? [];
    const live = state.live[type] ?? 0;
    const sum = bucket.reduce((acc, val) => acc + val, 0);
    const p95 = percentile(bucket, 0.95);
    const max = Math.max(0, ...bucket);
    const slowFrames = bucket.filter((value) => value >= BUDGET_MS).length;
    const disabled = channel === "draw" && !drawSystemEnabled(type);
    return {
      status: disabled ? "off" : slowFrames > 0 ? "SLOW" : "ok",
      type,
      disabled,
      live,
      avg: sum / Math.max(1, bucket.length),
      p95,
      max,
      slowFrames,
      share: live / Math.max(0.001, total),
    };
  }

  const renderTabs = () => {
    (Object.keys(channels) as TimingChannel[]).forEach((channel) => {
      const state = channels[channel];
      state.button.textContent = `${channelLabels[channel]} ${round(state.total).toFixed(3)}ms`;
      state.button.style.background = channel === activeChannel ? "#0f172a" : "#ffffff";
      state.button.style.color = channel === activeChannel ? "#ffffff" : "#111827";
      state.button.style.fontWeight = channel === activeChannel ? "700" : "400";
      state.button.style.display = channel === "draw" && !flags.DRAW_PERFORMANCE_LOGS ? "none" : "inline-block";
    });
    (Object.keys(sortButtons) as SortMode[]).forEach((mode) => {
      const button = sortButtons[mode];
      button.style.background = mode === sortMode ? "#0f172a" : "#ffffff";
      button.style.color = mode === sortMode ? "#ffffff" : "#111827";
      button.style.fontWeight = mode === sortMode ? "700" : "400";
    });
  }

  const sortRows = (a: Row, b: Row): number => {
    const disabled = Number(a.disabled) - Number(b.disabled);
    if (disabled !== 0) return disabled;
    if (sortMode === "live") {
      return b.live - a.live || b.avg - a.avg || b.p95 - a.p95 || b.max - a.max;
    }
    return b.avg - a.avg || b.p95 - a.p95 || b.max - a.max || b.live - a.live;
  }

  const render = () => {
    const state = channels[activeChannel];
    const rows = [...state.knownTypes]
      .map((type) => rowForType(activeChannel, type, state.total))
      .sort(sortRows)
      .slice(0, ROW_LIMIT);

    renderTabs();
    renderHeader();
    const disabledCount =
      activeChannel === "draw" ? [...state.knownTypes].filter((type) => !drawSystemEnabled(type)).length : 0;
    summary.textContent = `${channelLabels[activeChannel]} frame ${state.frame} | total ${round(state.total).toFixed(
      3
    )}ms | budget ${BUDGET_MS}ms | sort ${sortMode} | active ${state.latestCount}/${state.knownTypes.size} | showing ${rows.length}/${state.knownTypes.size}${
      disabledCount ? ` | disabled ${disabledCount}` : ""
    }`;
    tbody.replaceChildren();

    for (const row of rows) {
      const tr = document.createElement("tr");
      if (row.disabled) {
        tr.style.background = "#f1f5f9";
        tr.style.color = "#64748b";
      } else if (row.status === "SLOW") {
        tr.style.background = "#fee2e2";
      }
      const statusCell = cell(row.status);
      statusCell.style.color = row.disabled ? "#475569" : row.status === "SLOW" ? "#b91c1c" : "#166534";
      statusCell.style.fontWeight = "700";
      const cells = [
        statusCell,
        cell(row.type, "left"),
        cell(round(row.live).toFixed(3)),
        cell(round(row.avg).toFixed(3)),
        cell(round(row.p95).toFixed(3)),
        cell(round(row.max).toFixed(3)),
        cell(String(row.slowFrames)),
        cell(`${Math.round(row.share * 100)}%`),
      ];
      if (activeChannel === "draw") cells.unshift(drawToggleCell(row));
      tr.append(...cells);
      tbody.appendChild(tr);
    }
  }

  // @ts-ignore
  window.performanceUpdate = (timings: Timing[], channel: TimingChannel = "perf") => {
    const state = channels[channel] ?? channels.perf;
    state.frame += 1;
    const live = new Map<string, number>();
    for (const timing of timings) {
      live.set(timing.type, (live.get(timing.type) ?? 0) + timing.time);
      state.knownTypes.add(timing.type);
    }
    state.latestCount = live.size;
    state.live = Object.fromEntries([...state.knownTypes].map((type) => [type, live.get(type) ?? 0]));
    state.total = [...live.values()].reduce((acc, val) => acc + val, 0);
    for (const type of state.knownTypes) pushHistory(state, type, state.live[type] ?? 0);
    render();
  };

  render();
}
