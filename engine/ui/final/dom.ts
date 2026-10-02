/** Composed-tree helpers shared by retained views, native controls and HTML islands. */
export function composedParent(element: Element): HTMLElement | null {
    if (element.assignedSlot)
        return element.assignedSlot;
    if (element.parentElement)
        return element.parentElement;
    const root = element.getRootNode();
    return "host" in root ? (root as ShadowRoot).host as HTMLElement : null;
}
export function composedContains(parent: Node, child: Node | null): boolean {
    let current = child;
    while (current) {
        if (current === parent || parent.contains(current))
            return true;
        const root = current.getRootNode();
        current = "host" in root ? (root as ShadowRoot).host : null;
    }
    return false;
}
export function composedClosest(element: Element, selector: string): HTMLElement | null {
    let current: Element | null = element;
    while (current) {
        if (current.matches(selector))
            return current as HTMLElement;
        current = composedParent(current);
    }
    return null;
}
export function deepActiveElement(document: Document): HTMLElement | null {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement)
        element = element.shadowRoot.activeElement;
    return element as HTMLElement | null;
}
export function eventElement(event: Event): HTMLElement | null {
    const path = event.composedPath?.() ?? [];
    const target = path.find(item => !!item && "nodeType" in item && (item as Node).nodeType === 1) ?? event.target;
    return target && "nodeType" in target && (target as Node).nodeType === 1 ? target as HTMLElement : null;
}
/** Stable rendered-tree ordering even when compareDocumentPosition would return DISCONNECTED. */
export function composedOrder(a: HTMLElement, b: HTMLElement): number {
    if (a === b)
        return 0;
    const path = (element: HTMLElement) => {
        const result: HTMLElement[] = [];
        for (let node: HTMLElement | null = element; node; node = composedParent(node))
            result.unshift(node);
        return result;
    };
    const aa = path(a), bb = path(b);
    let index = 0;
    while (index < aa.length && index < bb.length && aa[index] === bb[index])
        index++;
    if (index === aa.length)
        return -1;
    if (index === bb.length)
        return 1;
    return aa[index].compareDocumentPosition(bb[index]) & 4 ? -1 : 1;
}
// Native .click() preserves checkbox/form default behavior. Carry controller ownership through
// its synchronous event dispatch without pretending MouseEvent.detail is a player number.
let nativePlayer: number | undefined;
export function eventPlayer(event: Event): number {
    const detail = (event as CustomEvent<{
        player?: number;
    }>).detail;
    return nativePlayer ?? (detail && typeof detail === "object" ? detail.player ?? 0 : 0);
}
export function withInputPlayer<T>(player: number, fn: () => T): T {
    const previous = nativePlayer;
    nativePlayer = player;
    try {
        return fn();
    }
    finally {
        nativePlayer = previous;
    }
}
