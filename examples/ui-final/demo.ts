import {
  UIFinal, signal, computed, effect, Model, CommandQueue, I18n,
  Panel, Row, Column, Grid, Text, Button, TextInput, Progress, Toggle, virtualList,
  type ModalHandle, type Readable,
} from "../../engine/ui/final/index";

interface Item { id: number; name: string; category: string; rarity: string; power: number; mass: number; }
const categories = ["All equipment", "Weapons", "Suit systems", "Navigation", "Supplies"];
const names = ["Aster pulse rifle", "Meridian field suit", "Parallax nav module", "Emergency medkit", "Helix coil carbine", "Vanguard shield core", "Deep-space beacon", "Oxygen reserve"];
const rarities = ["STANDARD", "RARE", "EXOTIC", "RARE"];
const rarityColors: Record<string, string> = { STANDARD: "#9baebb", RARE: "#86cbd9", EXOTIC: "#eab88a" };

/** Functional, asset-free inventory showcase. No Pixi or third-party UI dependency is needed. */
export function createUIFinalDemo(host: HTMLElement = document.body) {
  const ui = new UIFinal({ host, placement: "inline", scheduling: "manual", theme: {
    "--uif-font": 'Inter, "Segoe UI", system-ui, sans-serif', "--uif-font-size": "14px", "--uif-radius": "5px",
    "--uif-surface": "#17282e", "--uif-surface-raised": "#223b42", "--uif-border": "#385159", "--uif-accent": "#a4e7ce",
  } });
  const style = document.createElement("style");
  style.textContent = `
    [data-uif-root] .harbor-app { min-height:100dvh;background:radial-gradient(ellipse at 90% 8%,#1a3840 0,transparent 55%),#0c171d;padding:30px 42px 20px; }
    [data-uif-root] .harbor-header { display:flex;justify-content:space-between;align-items:center;gap:24px; }
    [data-uif-root] .harbor-workspace { display:grid;grid-template-columns:184px minmax(300px,1fr) 308px;gap:28px;margin-top:28px; }
    [data-uif-root] .harbor-label { font-size:10px;letter-spacing:.18em;color:#90a6ad;font-weight:650; }
    [data-uif-root] .harbor-nav { text-align:left;background:transparent;border-color:transparent;padding:12px 14px; }
    [data-uif-root] .harbor-row { display:flex;align-items:center;gap:14px;width:100%;height:60px;text-align:left;padding:8px 13px;border:1px solid #263b43;border-radius:4px; }
    [data-uif-root] .harbor-detail { background:linear-gradient(145deg,#1b3238,#14232b);border:1px solid #365159;border-radius:8px;padding:22px; }
    [data-uif-root] .harbor-primary { background:#a4e7ce;color:#142a24;border-color:#a4e7ce;font-weight:750; }
    [data-uif-root] .harbor-primary:hover { background:#cbfbe9; }
    [data-uif-root] .harbor-footer { display:flex;justify-content:space-between;align-items:center;gap:18px;margin-top:23px;padding-top:18px;border-top:1px solid #2a3d44;flex-wrap:wrap; }
    @media(max-width:1080px) { [data-uif-root] .harbor-app { padding:22px; } [data-uif-root] .harbor-workspace { grid-template-columns:minmax(280px,1fr) 290px;gap:18px; } [data-uif-root] .harbor-sidebar { grid-column:1/-1;flex-direction:row!important;flex-wrap:wrap;align-items:center; } [data-uif-root] .harbor-nav { padding:8px 12px; } [data-uif-root] .harbor-sidebar-info { display:none; } }
    @media(max-width:700px) { [data-uif-root] .harbor-app { padding:18px 14px; } [data-uif-root] .harbor-header { align-items:flex-start;flex-direction:column;gap:14px; } [data-uif-root] .harbor-workspace { grid-template-columns:minmax(0,1fr); } [data-uif-root] .harbor-detail { margin-top:2px; } }
  `;
  ui.root.appendChild(style);
  const data: Item[] = Array.from({ length: 100000 }, (_, index) => ({
    id: index + 1, name: `${names[index % names.length]}${index >= names.length ? ` · ${index + 1}` : ""}`,
    category: categories[index % 4 + 1], rarity: rarities[index % 4], power: 35 + index * 17 % 64, mass: (9 + index % 37) / 10,
  }));
  const model = new Model({ credits: 24680, equipped: "No equipment selected", status: "Systems ready. Select an item to inspect its loadout." });
  const query = signal(""), category = signal(categories[0]), selected = signal(data[2]);
  const listHeight = signal(Math.max(300, Math.min(560, host.ownerDocument.defaultView!.innerHeight - 340)));
  const highContrast = signal(false), reducedMotion = signal(ui.reducedMotion.peek()), commandCount = signal(0);
  const queue = new CommandQueue();
  const i18n = new I18n("en", {
    en: { direction: "ltr", messages: { title: "Equipment bay", subtitle: "Prepare for the next horizon.", equip: "Equip to loadout", search: "Search equipment…", items: "{count} items in storage" } },
    ar: { direction: "rtl", messages: { title: "مخزن المعدات", subtitle: "استعد للأفق القادم.", equip: "تجهيز المعدات", search: "ابحث عن المعدات…", items: "{count} عنصر في المخزن" } },
  }, ui.scope);
  const visible = computed(() => {
    const filter = query.get().trim().toLocaleLowerCase(), group = category.get();
    if (!filter && group === categories[0]) return data;
    return data.filter(item => (group === categories[0] || item.category === group) && (!filter || item.name.toLocaleLowerCase().includes(filter)));
  }, Object.is, ui.scope);
  ui.scope.add(() => model.dispose());
  effect(() => { ui.setReducedMotion(reducedMotion.get()); }, { scope: ui.scope, scheduler: ui.scheduler });
  effect(() => { ui.setTheme(highContrast.get() ? { "--uif-border": "#d4e2e8", "--uif-text": "#fff", "--uif-focus-0": "#fff06b" } : { "--uif-accent": "#a4e7ce" }); }, { scope: ui.scope, scheduler: ui.scheduler });
  const label = (value: string) => Text(value, { class: "harbor-label" });
  const stat = (name: string, value: () => string) => Row({ style: { justifyContent: "space-between", marginTop: 13, gap: 12 } }, Text(name, { style: { color: "#a1b5bb" } }), Text(value, { style: { fontWeight: 650 } }));
  let modal: ModalHandle | undefined;
  function confirmEquip() {
    const item = selected.peek();
    modal = ui.openModal(Column({ style: { width: "min(440px, 82vw)", padding: 28, gap: 18, background: "#14272e", border: "1px solid #597780", borderRadius: 10 } },
      label("LOADOUT CONFIRMATION"), Text(`Equip ${item.name}?`, { style: { fontSize: 25, fontWeight: 650 } }),
      Text("The interface submits a data-only command. Your authoritative game logic decides whether the equipment change is valid.", { style: { color: "#afc1c7", lineHeight: 1.65 } }),
      Row({ style: { gap: 10, justifyContent: "flex-end" } },
        Button({ id: "cancel-equip", on: { activate: () => modal?.close() } }, "Cancel"),
        Button({ id: "confirm-equip", class: "harbor-primary", on: { activate: event => { queue.enqueue(event.player, "inventory:equip", { itemId: item.id }); modal?.close(); } } }, "Confirm equip"))),
      { label: "Confirm equipment change", onClose: () => { modal = undefined; } });
  }
  const itemRow = (item: Readable<Item>, index: Readable<number>) => Button({
    class: "harbor-row", label: () => `${item.get().name}, ${item.get().rarity}, power ${item.get().power}`,
    attrs: { "aria-pressed": () => selected.get().id === item.get().id },
    style: { background: () => selected.get().id === item.get().id ? "#23423f" : "#12232a", borderColor: () => selected.get().id === item.get().id ? "#88bca9" : "#263b43" },
    on: { activate: () => { selected.set(item.peek()); } },
  },
    Panel({ style: { width: 38, height: 38, flexShrink: 0, display: "grid", placeItems: "center", background: "#223b42", border: "1px solid #426069", borderRadius: 6, color: () => rarityColors[item.get().rarity], fontSize: 20 } }, Text(() => ["◇", "⬡", "◈", "+"][item.get().id % 4])),
    Column({ style: { flex: 1, gap: 3 } }, Text(() => item.get().name, { style: { fontWeight: 600, fontSize: 13 } }), Text(() => `${item.get().category}  /  ${item.get().rarity}`, { style: { fontSize: 9, letterSpacing: ".08em", color: () => rarityColors[item.get().rarity] } })),
    Text(() => String(item.get().power), { style: { fontVariantNumeric: "tabular-nums", color: "#c6e5de", fontSize: 19, fontWeight: 550 } }));
  ui.mount(Panel({ class: "harbor-app", dir: i18n.direction, lang: i18n.locale },
    Row({ class: "harbor-header" },
      Column({ style: { gap: 7 } }, Row({ style: { alignItems: "center", gap: 10 } }, Text("◈", { style: { color: "#a4e7ce", fontSize: 23 } }), Text("SKY HARBOR", { style: { fontSize: 12, letterSpacing: ".23em", fontWeight: 750 } }), Text("/ UI FINAL", { style: { fontSize: 10, letterSpacing: ".13em", color: "#78969e" } })),
        Text(() => i18n.t("title"), { role: "heading", attrs: { "aria-level": 1 }, style: { fontSize: "clamp(30px,4vw,44px)", fontWeight: 580, letterSpacing: "-.035em", lineHeight: 1.2 } }),
        Text(() => i18n.t("subtitle"), { style: { color: "#98aeb6", fontSize: 13 } })),
      Column({ style: { alignItems: "flex-end", gap: 9 } }, label("PATHFINDER  /  LEVEL 24"), Row({ style: { gap: 12, alignItems: "center" } }, Text(() => `${i18n.number(model.get<number>("credits"))} CR`, { style: { fontSize: 20, color: "#d9c9a4" } }), Button({ id: "language", label: "Switch English and Arabic", on: { activate: () => i18n.setLocale(i18n.locale.peek() === "en" ? "ar" : "en") } }, "EN / العربية")))),
    Grid({ class: "harbor-workspace" },
      Column({ class: "harbor-sidebar", style: { gap: 5 } }, label("STORAGE"), ...categories.map((group, index) => Button({ id: `category-${index}`, class: "harbor-nav", attrs: { "aria-pressed": () => category.get() === group }, style: { borderColor: () => category.get() === group ? "#52766b" : "transparent", background: () => category.get() === group ? "#1a332f" : "transparent", color: () => category.get() === group ? "#b9ecd8" : "#a0b6be" }, on: { activate: () => category.set(group) } }, group)),
        Column({ class: "harbor-sidebar-info", style: { marginTop: 36, gap: 12, borderTop: "1px solid #2b4047", paddingTop: 22 } }, label("ACTIVE LOADOUT"), Text(() => model.get<string>("equipped"), { style: { color: "#cbe9df", fontSize: 13 } }), Text("One retained tree. No per-frame document rebuild.", { style: { fontSize: 11, color: "#839fa8", lineHeight: 1.7 } }))),
      Column({ style: { gap: 13 } },
        Row({ style: { alignItems: "center", gap: 12 } }, TextInput({ id: "search", inputType: "search", bindValue: query, label: "Search equipment", placeholder: () => i18n.t("search"), style: { flex: 1, height: 42, background: "#102027" } }),
          Button({ id: "reset", label: "Reset filters", on: { activate: () => { query.set(""); category.set(categories[0]); } } }, "Reset")),
        Row({ style: { justifyContent: "space-between" } }, Text(() => i18n.t("items", { count: i18n.number(visible.get().length) }), { class: "harbor-label" }), label("POWER")),
        virtualList({ key: "inventory", items: visible, itemKey: item => item.id, rowHeight: 64, height: listHeight, overscan: 2,
          props: { id: "inventory-list", label: "Equipment inventory", style: { padding: "2px 7px 2px 2px", scrollbarColor: "#517578 #102027", scrollbarWidth: "thin" } }, render: itemRow }),
        Text(() => visible.get().length ? "Select to inspect · Arrow keys to navigate · Enter to activate" : "No matching equipment. Clear the search or change category.", { style: { color: "#8aa6ae", fontSize: 11 } })),
      Column({ class: "harbor-detail", style: { gap: 13, alignSelf: "start" } },
        Row({ style: { justifyContent: "space-between", alignItems: "center" } }, label("ITEM INSPECTOR"), Text(() => selected.get().rarity, { style: { fontSize: 10, letterSpacing: ".15em", color: () => rarityColors[selected.get().rarity] } })),
        Panel({ style: { height: 140, display: "grid", placeItems: "center", background: "radial-gradient(ellipse,#355b58,transparent 70%)", borderBottom: "1px solid #365057" } }, Text("◈", { style: { fontSize: 90, lineHeight: 1, color: "#a3d6c5", textShadow: "0 0 30px #648c79", transform: "rotate(-12deg)" } })),
        Text(() => selected.get().name, { role: "heading", attrs: { "aria-level": 2 }, style: { fontSize: 23, fontWeight: 590, lineHeight: 1.25, letterSpacing: "-.02em" } }),
        Text("Purpose-built for expeditions beyond the mapped frontier. Reliable under pressure. Ready for the unknown.", { style: { fontSize: 12, color: "#a1b7bf", lineHeight: 1.8 } }),
        Column({ style: { gap: 3 } }, stat("Output rating", () => `${selected.get().power} / 100`), Progress({ label: "Equipment output", max: 100, value: () => selected.get().power, style: { width: "100%", height: 7, marginTop: 6 } }), stat("Mass", () => `${selected.get().mass.toFixed(1)} kg`), stat("Condition", () => "Operational")),
        Button({ id: "equip", class: "harbor-primary", style: { marginTop: 10, minHeight: 44 }, on: { activate: confirmEquip } }, Text(() => i18n.t("equip"))),
        Text("Command-queued · Player-aware · Focus-safe", { style: { fontSize: 10, color: "#82a29f", textAlign: "center" } }))),
    Row({ class: "harbor-footer" },
      Column({ style: { gap: 5 } }, Text(() => model.get<string>("status"), { style: { color: "#bbd9ce", fontSize: 12 } }), Text(() => `100,000 source items  /  bounded visible rows  /  ${commandCount.get()} committed commands`, { style: { fontSize: 10, color: "#78969f", letterSpacing: ".045em" } })),
      Row({ style: { alignItems: "center", gap: 17, flexWrap: "wrap" } }, Row({ style: { alignItems: "center", gap: 7 } }, Toggle({ id: "reduce-motion", label: "Reduced motion", bindChecked: reducedMotion }), Text("Reduced motion", { style: { fontSize: 11 } })), Row({ style: { alignItems: "center", gap: 7 } }, Toggle({ id: "contrast", label: "High contrast borders", bindChecked: highContrast }), Text("High contrast", { style: { fontSize: 11 } }))))));
  let last = performance.now(), raf = 0;
  const frame = (now: number) => {
    // Demo-only consumer. A real game drains this queue at its authoritative input boundary.
    queue.drain(command => {
      const item = data[(command.payload as { itemId: number }).itemId - 1];
      if (!item) return;
      model.patch({ equipped: item.name, status: `${item.name} equipped. Loadout synchronized.` });
      commandCount.update(value => value + 1); ui.announce(`${item.name} equipped.`);
    });
    ui.frame(Math.max(0, now - last)); last = now; raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const resize = () => listHeight.set(Math.max(300, Math.min(560, host.ownerDocument.defaultView!.innerHeight - 340)));
  host.ownerDocument.defaultView!.addEventListener("resize", resize);
  ui.scope.add(() => { cancelAnimationFrame(raf); host.ownerDocument.defaultView!.removeEventListener("resize", resize); });
  return { ui, model, query, category, selected, visible, queue, dispose: () => ui.dispose() };
}
