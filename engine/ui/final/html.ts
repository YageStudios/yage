import { computed, effect, read, Scope, signal, untrack, type Dispose, type Equality, type Readable, type Value } from "./reactive";
import type { Child, Key, Props } from "./nodes";
import type { RenderContext } from "./render";
import { baseCSS } from "./theme";
import { composedContains, eventElement, eventPlayer, withInputPlayer } from "./dom";
/** Project-authored templates only. Shadow DOM isolates styling, NOT untrusted code. */
export interface HTMLComponentDefinition<S, E extends object = {}> {
    readonly name: string;
    /** Static fragment. Scripts, inline handlers and embedded browsing contexts are rejected. */
    readonly template: string;
    readonly styles?: string;
    /** Runs exactly once per mounted definition/key. Use bindings instead of rebuilding the markup. */
    readonly setup?: (context: HTMLComponentContext<S, E>) => void | Dispose;
}
export type HTMLComponentEvents<E extends object> = {
    readonly [K in keyof E]?: (detail: E[K]) => void;
};
export type HTMLComponentProps<S, E extends object = {}> = Omit<Props, "text" | "value" | "bindValue" | "bindChecked" | "checked"> & {
    state: Value<S>;
    events?: HTMLComponentEvents<E>;
};
export interface HTMLNode<S = any, E extends object = any> {
    kind: "html";
    definition: Readonly<HTMLComponentDefinition<S, E>>;
    state: Value<S>;
    events?: HTMLComponentEvents<E>;
    props: Props;
    key?: Key;
}
export interface HTMLComponent<S, E extends object = {}> {
    (props: HTMLComponentProps<S, E>): HTMLNode<S, E>;
    readonly definition: Readonly<HTMLComponentDefinition<S, E>>;
}
export interface HTMLComponentContext<S, E extends object = {}> {
    readonly host: HTMLElement;
    readonly root: ShadowRoot;
    readonly document: Document;
    readonly state: Readable<S>;
    readonly scope: Scope;
    readonly abortSignal: AbortSignal;
    readonly reducedMotion: Readable<boolean>;
    query<T extends Element = HTMLElement>(selector: string): T;
    /** Per-value equality; update runs untracked so incidental reads cannot widen dependencies. */
    bind<T>(source: Value<T>, update: (value: T) => void, equals?: Equality<T>): Dispose;
    effect(fn: () => void | Dispose): Dispose;
    listen<K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions | boolean): Dispose;
    listen(target: EventTarget, type: string, listener: (event: Event) => void, options?: AddEventListenerOptions | boolean): Dispose;
    emit<K extends keyof E>(name: K, detail: E[K]): void;
    onCleanup(cleanup: Dispose): Dispose;
    /** UI Final presentation clock, never an independent RAF. Cancel when animation becomes idle. */
    onFrame(task: (dtMs: number) => void): Dispose;
    /** Optional UI Final children inside this component, owned by the component scope. */
    mount(target: HTMLElement, child: Child): {
        update(child: Child): void;
        dispose(): void;
    };
    /** Automatically called after setup; call after synchronous structural changes before navigation. */
    refreshFocus(): void;
}
export function defineHTMLComponent<S, E extends object = {}>(definition: HTMLComponentDefinition<S, E>): HTMLComponent<S, E> {
    if (!/^[A-Za-z][\w./-]*$/.test(definition.name))
        throw new Error("UIF_HTML_NAME: expected a stable component name");
    if (typeof definition.template !== "string")
        throw new Error("UIF_HTML_TEMPLATE: expected static HTML");
    const owned = Object.freeze({ ...definition });
    const component = (options: HTMLComponentProps<S, E>): HTMLNode<S, E> => {
        const { state, events, ...props } = options;
        return { kind: "html", definition: owned, state, events, props, key: props.key };
    };
    return Object.assign(component, { definition: owned });
}
export interface HTMLPolicy {
    createHTML(input: string): unknown;
}
function parseTemplate(document: Document, source: string, policy?: HTMLPolicy): HTMLTemplateElement {
    const template = document.createElement("template");
    // The cast preserves a host-supplied TrustedHTML object at runtime; no policy is silently created.
    template.innerHTML = (policy ? policy.createHTML(source) : source) as string;
    return template;
}
/** Reject active markup before insertion. This is a guardrail for trusted assets, NOT an HTML sanitizer. */
export function validateHTMLFragment(fragment: DocumentFragment): void {
    const forbidden = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "base", "meta", "link"]);
    const check = (root: DocumentFragment) => {
        for (const element of root.querySelectorAll("*")) {
            if (forbidden.has(element.localName))
                throw new Error(`UIF_HTML_ACTIVE_CONTENT: <${element.localName}> is not allowed`);
            for (const attribute of element.attributes) {
                const name = attribute.name.toLowerCase();
                if (name.startsWith("on") || name === "srcdoc" || name === "shadowrootmode" || name.startsWith("data-uif-")) {
                    throw new Error(`UIF_HTML_ACTIVE_CONTENT: ${name} is forbidden in templates`);
                }
                if (["href", "src", "xlink:href", "action", "formaction"].includes(name)) {
                    const value = attribute.value.replace(/[\u0000-\u0020\u007f]/g, "");
                    if (/^(javascript|vbscript):/i.test(value) || /^data:/i.test(value) && !/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(value)) {
                        throw new Error(`UIF_HTML_ACTIVE_CONTENT: unsafe ${name} protocol`);
                    }
                }
            }
            if (element.localName === "template")
                check((element as HTMLTemplateElement).content);
        }
    };
    check(fragment);
}
/** Extract a chosen component fragment from a project HTML file. Surrounding scripts are NEVER run.
 * Styles are returned verbatim: adapt body/:root selectors to :host and remove page-only styling.
 */
export function extractHTMLComponent(source: string, selector: string, document: Document = globalThis.document, policy?: HTMLPolicy): {
    template: string;
    styles: string;
} {
    if (!document)
        throw new Error("UIF_PLATFORM: HTML extraction requires a Document");
    const parsed = parseTemplate(document, source, policy);
    const selected = parsed.content.querySelector(selector);
    if (!selected)
        throw new Error(`UIF_HTML_SELECTOR: missing ${selector}`);
    const clone = document.createDocumentFragment();
    clone.appendChild(selected.cloneNode(true));
    validateHTMLFragment(clone);
    return { template: selected.outerHTML, styles: [...parsed.content.querySelectorAll("style")].map(style => style.textContent ?? "").join("\n") };
}
const focusSelector = 'button,input:not([type="hidden"]),textarea,select,a[href],[tabindex],[contenteditable="true"]';
const inputEvents = new Set(["click", "dblclick", "input", "change", "submit", "pointerdown", "pointerup", "pointermove", "keydown", "keyup", "uif-activate", "uif-cancel"]);
const templates = new WeakMap<object, WeakMap<Document, HTMLTemplateElement>>();
const shadowCSS = `@layer ui-final-defaults { ${baseCSS.replaceAll("[data-uif-root][data-uif-reduced-motion]", ":host([data-uif-reduced-motion])").replaceAll("[data-uif-root]", ":host")} }
:host{display:block} :host([hidden]){display:none!important}
[hidden]{display:none!important}button,input,textarea,select,a[href],[tabindex],[contenteditable]{pointer-events:auto}
[data-uif-players]{outline:2px solid var(--uif-focus-0,#89d3ff);outline-offset:3px}
[data-uif-players~="1"]{outline-color:var(--uif-focus-1,#ffbc7f)}
[data-uif-players~="2"]{outline-color:var(--uif-focus-2,#b6ee94)}
[data-uif-players~="3"]{outline-color:var(--uif-focus-3,#e2b1ff)}
`;
/** Renderer-owned instance. Public authoring uses defineHTMLComponent, not this adapter. */
export class HTMLInstance {
    private readonly stateSource;
    private readonly state;
    private readonly root: ShadowRoot;
    private readonly focusEntries = new Map<HTMLElement, {
        id: string;
        dispose: Dispose;
    }>();
    private focusSequence = 0;
    private readonly generatedFocusIds = new WeakMap<HTMLElement, string>();
    constructor(private spec: HTMLNode, readonly host: HTMLElement, private ctx: RenderContext, readonly scope: Scope, mount: HTMLComponentContext<unknown>["mount"]) {
        if ("text" in spec.props)
            throw new Error("UIF_HTML_PROPS: HTML components own their internal text");
        this.stateSource = signal(spec.state);
        this.state = computed(() => read(this.stateSource.get()), undefined, scope);
        this.root = host.attachShadow({ mode: "open" });
        const document = ctx.document;
        // Cache only when no external Trusted Types policy is involved (policies can differ per runtime).
        let byDocument = templates.get(spec.definition);
        if (!byDocument) {
            byDocument = new WeakMap();
            templates.set(spec.definition, byDocument);
        }
        let template = ctx.htmlPolicy ? undefined : byDocument.get(document);
        if (!template) {
            template = parseTemplate(document, spec.definition.template, ctx.htmlPolicy);
            validateHTMLFragment(template.content);
            if (!ctx.htmlPolicy)
                byDocument.set(document, template);
        }
        const style = document.createElement("style");
        if (ctx.styleNonce)
            style.nonce = ctx.styleNonce;
        style.textContent = shadowCSS + (spec.definition.styles ?? "");
        this.root.append(style, document.importNode(template.content, true));
        host.dataset.uifComponent = spec.definition.name;
        effect(() => { host.toggleAttribute("data-uif-reduced-motion", ctx.reducedMotion.get()); }, { scope, scheduler: ctx.scheduler, name: `${spec.definition.name}.motion` });
        const abort = new document.defaultView!.AbortController();
        scope.add(() => { abort.abort(); for (const entry of this.focusEntries.values())
            entry.dispose(); this.focusEntries.clear(); });
        const own = (cleanup: Dispose): Dispose => {
            if (scope.disposed) {
                cleanup();
                throw new Error("UIF_SCOPE_DISPOSED: HTML resource created after disposal");
            }
            let alive = true;
            const dispose = () => { if (alive) {
                alive = false;
                unlink();
                cleanup();
            } };
            const unlink = scope.add(dispose);
            return dispose;
        };
        const listen = (target: EventTarget, type: string, fn: (event: any) => void, options?: AddEventListenerOptions | boolean): Dispose => {
            const handler = (event: Event) => {
                if (scope.disposed)
                    return;
                const element = eventElement(event) ?? host;
                if (inputEvents.has(type) && !ctx.focus.allows(element, eventPlayer(event)))
                    return;
                try {
                    untrack(() => fn(event));
                }
                catch (error) {
                    ctx.report(error);
                }
            };
            target.addEventListener(type, handler, options);
            return own(() => target.removeEventListener(type, handler, options));
        };
        // Block native default actions as well as application listeners when any composed ancestor
        // is disabled/inert/player-restricted or another runtime owns a modal.
        for (const type of inputEvents) {
            const guard = (event: Event) => {
                if (!ctx.focus.allows(eventElement(event) ?? host, eventPlayer(event))) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            };
            this.root.addEventListener(type, guard, true);
            scope.add(() => this.root.removeEventListener(type, guard, true));
        }
        const context: HTMLComponentContext<any, any> = {
            host, root: this.root, document, state: this.state, scope, abortSignal: abort.signal, reducedMotion: ctx.reducedMotion,
            query: <T extends Element>(selector: string): T => {
                const element = this.root.querySelector<T>(selector);
                if (!element)
                    throw new Error(`UIF_HTML_SELECTOR: ${spec.definition.name} is missing ${selector}`);
                return element;
            },
            bind: <T>(source: Value<T>, update: (value: T) => void, equals?: Equality<T>): Dispose => {
                const lifetime = new Scope(scope);
                const selected = computed(() => read(source), equals, lifetime);
                try {
                    effect(() => { const value = selected.get(); untrack(() => update(value)); }, { scope: lifetime, scheduler: ctx.scheduler, name: `${spec.definition.name}.binding` });
                }
                catch (error) {
                    lifetime.dispose();
                    throw error;
                }
                return () => lifetime.dispose();
            },
            effect: fn => effect(fn, { scope, scheduler: ctx.scheduler, name: `${spec.definition.name}.effect` }),
            listen,
            emit: (name, detail) => {
                if (scope.disposed)
                    return;
                try {
                    untrack(() => this.spec.events?.[name]?.(detail));
                }
                catch (error) {
                    ctx.report(error);
                }
            },
            onCleanup: own,
            onFrame: task => own(ctx.addFrameTask(dt => {
                if (scope.disposed)
                    return;
                try {
                    untrack(() => task(dt));
                }
                catch (error) {
                    ctx.report(error);
                }
            })),
            mount: (target, child) => {
                if (!composedContains(this.root, target))
                    throw new Error("UIF_HTML_MOUNT: target must belong to this component");
                return mount(target, child);
            },
            refreshFocus: () => this.refreshFocus(),
        };
        const cleanup = untrack(() => scope.run(() => spec.definition.setup?.(context)));
        if (cleanup)
            scope.add(cleanup);
        this.refreshFocus();
        const observer = new document.defaultView!.MutationObserver(records => {
            // Flap/text animation replaces Text nodes: don't rescan controls on every glyph frame.
            if (records.some(record => record.type === "attributes" || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1))) {
                try {
                    this.refreshFocus();
                }
                catch (error) {
                    ctx.report(error);
                }
            }
        });
        observer.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: ["tabindex", "type", "href", "contenteditable", "data-focus", "id"] });
        scope.add(() => observer.disconnect());
    }
    refreshFocus(): void {
        if (this.scope.disposed)
            return;
        const controls = [...this.root.querySelectorAll<HTMLElement>(focusSelector)].filter(element => !element.hasAttribute("data-uif-node") && !element.matches('input[type="hidden"]') &&
            (element.tabIndex >= 0 || !element.hasAttribute("tabindex") && element.matches('[contenteditable="true"]')));
        const names = new Map<HTMLElement, string>();
        const ids = new Set<string>();
        for (const element of controls) {
            let local = element.getAttribute("data-focus") || element.id || this.generatedFocusIds.get(element);
            if (!local) {
                local = `control-${++this.focusSequence}`;
                this.generatedFocusIds.set(element, local);
            }
            const id = `${this.host.dataset.uifId}/${local}`;
            if (ids.has(id))
                throw new Error(`UIF_DUPLICATE_ID: ${id}`);
            ids.add(id);
            names.set(element, id);
        }
        for (const [element, entry] of this.focusEntries)
            if (names.get(element) !== entry.id) {
                entry.dispose();
                this.focusEntries.delete(element);
            }
        for (const element of controls) {
            if (this.focusEntries.has(element))
                continue;
            const id = names.get(element)!;
            const release = this.ctx.focus.register({ id, element, players: () => undefined, navigation: () => ({}) });
            const accept = (event: Event) => {
                if (eventElement(event) !== element || !this.ctx.focus.allows(element, eventPlayer(event)))
                    return;
                event.stopPropagation();
                if (element.matches("button,a[href],input[type=checkbox],input[type=radio],input[type=button],input[type=submit]")) {
                    withInputPlayer(eventPlayer(event), () => element.click());
                }
                else
                    element.focus({ preventScroll: true });
            };
            element.addEventListener("uif-activate", accept);
            this.focusEntries.set(element, { id, dispose: () => { release(); element.removeEventListener("uif-activate", accept); } });
        }
    }
    patch(spec: HTMLNode): void {
        this.spec = spec;
        this.stateSource.set(spec.state);
        this.refreshFocus();
    }
}
