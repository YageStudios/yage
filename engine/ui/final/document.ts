import type { HTMLComponent } from "./html";
import { dynamic, each, h, virtualList, type Child, type EventHandlers, type NodeType, type Props, type UIEvent, type UIEventType } from "./nodes";
import { getPath, pathSegments } from "./model";
import { read, type Readable, type Value } from "./reactive";
import type { UIFinal } from "./runtime";

export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export interface Binding {
  $bind: string;
  format?: string;
  fallback?: JSONValue;
}
export type DocumentValue = JSONValue | Binding;
export interface DocumentElement {
  type: NodeType;
  key?: string | number;
  props?: Record<string, DocumentValue | Record<string, DocumentValue>>;
  on?: Partial<Record<UIEventType, string | { action: string; args?: Record<string, DocumentValue> }>>;
  children?: DocumentNode[];
}
export interface DocumentWhen { when: Binding; then: DocumentNode; else?: DocumentNode; key?: string | number; }
export interface DocumentEach {
  each: Binding;
  as: string;
  itemKey: string;
  template: DocumentNode;
  key?: string | number;
  virtual?: { height: number; rowHeight: number; overscan?: number; label?: string };
}
/** HTML code is registered in application TypeScript, never executed from a JSON asset. */
export interface DocumentComponent {
  component: string;
  state: DocumentValue;
  key?: string | number;
  props?: Record<string, DocumentValue | Record<string, DocumentValue>>;
  events?: Readonly<Record<string, string>>;
}
export type DocumentNode = DocumentElement | DocumentComponent | DocumentWhen | DocumentEach | string | number;
export interface UIDocument { schema: "ui-final/1"; root: DocumentNode; }
export interface DocumentBindings {
  model: { select<V = unknown>(path: string): Readable<V> };
  actions?: Readonly<Record<string, (event: UIEvent, args?: Readonly<Record<string, unknown>>) => void>>;
  formatters?: Readonly<Record<string, (value: unknown) => string | number | boolean>>;
  components?: Readonly<Record<string, HTMLComponent<any, any>>>;
  /** Typed components emit data, not synthetic UIEvent objects. Keep these actions separate. */
  componentActions?: Readonly<Record<string, (detail: any) => void>>;
}
export class DocumentError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) {
    super(`${code} at ${path}: ${message}`);
    this.name = "DocumentError";
  }
}
const nodeTypes = new Set<NodeType>(["panel", "row", "column", "grid", "text", "button", "input", "textarea", "image", "scroll", "progress", "slider", "toggle"]);
const events = new Set<UIEventType>(["activate", "input", "change", "submit", "cancel", "focus", "blur", "pointerDown", "pointerUp", "pointerMove", "pointerCancel", "keyDown", "keyUp"]);
const props = new Set(["id", "class", "style", "attrs", "text", "value", "checked", "indeterminate", "disabled", "hidden", "readOnly", "placeholder", "title", "label", "describedBy", "role", "lang", "dir", "src", "alt", "min", "max", "step", "maxLength", "name", "inputType", "autoComplete", "focusable", "autoFocus", "players", "navigation", "focusScope", "interactive"]);
const staticProps = new Set(["id", "role", "name", "inputType", "autoComplete", "focusable", "autoFocus", "focusScope"]);
const booleanProps = new Set(["checked", "indeterminate", "disabled", "hidden", "readOnly", "focusable", "autoFocus", "interactive"]);
const numberProps = new Set(["min", "max", "step", "maxLength"]);
const stringProps = new Set(["id", "class", "placeholder", "title", "label", "describedBy", "role", "lang", "dir", "src", "alt", "name", "inputType", "autoComplete", "focusScope"]);
function fail(code: string, path: string, message: string): never { throw new DocumentError(code, path, message); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return fail("UIF_DOCUMENT_OBJECT", path, "expected a plain object");
  }
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("UIF_DOCUMENT_FIELD", `${path}.${key}`, "unknown field");
}
function binding(value: unknown): value is Binding { return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "$bind"); }
function validatePath(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") fail("UIF_DOCUMENT_PATH", path, "expected a dotted path");
  try { pathSegments(value as string); } catch { fail("UIF_DOCUMENT_PATH", path, "invalid or unsafe path"); }
}
/** Limits apply before recursive traversal; object input may contain cycles and is not assumed to be JSON. */
export function parseDocument(input: string | unknown): UIDocument {
  let source: unknown;
  if (typeof input === "string") {
    if (input.length > 1_000_000) fail("UIF_DOCUMENT_LIMIT", "$", "document exceeds 1 MB of UTF-16 code units");
    try { source = JSON.parse(input); } catch (error) {
      if (error instanceof DocumentError) throw error;
      fail("UIF_DOCUMENT_JSON", "$", "invalid JSON; use UiLoader for JSON5 assets");
    }
  } else source = input;
  const seen = new Set<object>();
  let budget = 0;
  // Inspect all input values, not just nodes, so style/args objects cannot hide cycles, getters or functions.
  const scan = (value: unknown, path: string, depth: number): void => {
    if (++budget > 50000 || depth > 96) fail("UIF_DOCUMENT_LIMIT", path, "exceeded 50,000 values or 96 nested values");
    if (typeof value === "number" && !Number.isFinite(value)) fail("UIF_DOCUMENT_VALUE", path, "non-finite number");
    if (typeof value === "string" && value.length > 65536) fail("UIF_DOCUMENT_LIMIT", path, "string exceeds 65,536 code units");
    if (value === null || ["string", "boolean", "number"].includes(typeof value)) return;
    if (typeof value !== "object") fail("UIF_DOCUMENT_VALUE", path, "only JSON-compatible data is allowed");
    const record = value as object;
    if (seen.has(record)) fail("UIF_DOCUMENT_CYCLE", path, "cyclic object references are not accepted; use JSON values");
    seen.add(record);
    if (Object.getOwnPropertySymbols(record).length) fail("UIF_DOCUMENT_VALUE", path, "symbol keys are not allowed");
    if (!Array.isArray(value)) object(value, path);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(record))) {
      if (Array.isArray(value) && key === "length") continue;
      if (descriptor.get || descriptor.set || !descriptor.enumerable || ["__proto__", "prototype", "constructor"].includes(key)) {
        fail("UIF_DOCUMENT_VALUE", `${path}.${key}`, "accessors, reserved keys and non-enumerable properties are forbidden");
      }
      scan(descriptor.value, `${path}.${key}`, depth + 1);
    }
    seen.delete(record);
  };
  scan(source, "$", 0);
  const document = object(source, "$");
  keys(document, ["schema", "root"], "$");
  if (document.schema !== "ui-final/1") fail("UIF_DOCUMENT_VERSION", "$.schema", 'expected "ui-final/1"');
  let nodes = 0;
  const ids = new Set<string>();
  const validateValue = (value: unknown, path: string): void => {
    if (binding(value)) {
      const record = object(value, path);
      keys(record, ["$bind", "format", "fallback"], path);
      validatePath(record.$bind, `${path}.$bind`);
      if (record.format !== undefined && (typeof record.format !== "string" || !/^[A-Za-z][\w-]*$/.test(record.format))) fail("UIF_DOCUMENT_FORMAT", path, "invalid formatter name");
    }
  };
  const visit = (node: unknown, path: string, depth: number, repeated: boolean): void => {
    if (++nodes > 10000 || depth > 64) fail("UIF_DOCUMENT_LIMIT", path, "exceeded 10,000 nodes or 64 levels");
    if (typeof node === "string" || typeof node === "number") return;
    const record = object(node, path);
    if (record.key !== undefined && typeof record.key !== "string" && typeof record.key !== "number") fail("UIF_DOCUMENT_KEY", path, "key must be string or number");
    if ("component" in record) {
      keys(record, ["component", "state", "props", "events", "key"], path);
      if (typeof record.component !== "string" || !/^[A-Za-z][\w./-]*$/.test(record.component)) fail("UIF_DOCUMENT_COMPONENT", path, "expected a registered component name");
      if (!("state" in record)) fail("UIF_DOCUMENT_COMPONENT", `${path}.state`, "state is required");
      validateValue(record.state, `${path}.state`);
      if (record.events !== undefined) for (const [event, action] of Object.entries(object(record.events, `${path}.events`))) {
        if (!/^[A-Za-z][\w:-]*$/.test(event) || typeof action !== "string" || !action) fail("UIF_DOCUMENT_COMPONENT_EVENT", `${path}.events.${event}`, "expected an event-to-action name mapping");
      }
      if (record.props !== undefined) for (const name of Object.keys(object(record.props, `${path}.props`))) {
        if (!["id", "class", "style", "attrs", "disabled", "hidden", "title", "label", "describedBy", "role", "lang", "dir", "focusable", "autoFocus", "players", "navigation", "focusScope", "interactive"].includes(name)) fail("UIF_DOCUMENT_PROP", `${path}.props.${name}`, "not a component host property");
      }
      // Reuse normal host property/ID validation rather than maintaining a weaker second parser.
      visit({ type: "panel", ...(record.key !== undefined ? { key: record.key } : {}), ...(record.props !== undefined ? { props: record.props } : {}) }, path, depth + 1, repeated);
      return;
    }
    if ("when" in record) {
      keys(record, ["when", "then", "else", "key"], path);
      if (!binding(record.when)) fail("UIF_DOCUMENT_BINDING", `${path}.when`, "expected a binding");
      validateValue(record.when, `${path}.when`);
      visit(record.then, `${path}.then`, depth + 1, repeated);
      if (record.else !== undefined) visit(record.else, `${path}.else`, depth + 1, repeated);
      return;
    }
    if ("each" in record) {
      keys(record, ["each", "as", "itemKey", "template", "virtual", "key"], path);
      if (!binding(record.each)) fail("UIF_DOCUMENT_BINDING", `${path}.each`, "expected a binding");
      validateValue(record.each, `${path}.each`);
      validatePath(record.as, `${path}.as`);
      if ((record.as as string).includes(".") || record.as === "$index") fail("UIF_DOCUMENT_ALIAS", path, "alias must be a single identifier other than $index");
      validatePath(record.itemKey, `${path}.itemKey`);
      if (record.virtual !== undefined) {
        const virtual = object(record.virtual, `${path}.virtual`);
        keys(virtual, ["height", "rowHeight", "overscan", "label"], `${path}.virtual`);
        if (typeof virtual.height !== "number" || virtual.height <= 0 || typeof virtual.rowHeight !== "number" || virtual.rowHeight <= 0) fail("UIF_DOCUMENT_VIRTUAL", path, "height and rowHeight must be positive");
        if (virtual.overscan !== undefined && (!Number.isInteger(virtual.overscan) || (virtual.overscan as number) < 0 || (virtual.overscan as number) > 100)) fail("UIF_DOCUMENT_VIRTUAL", path, "overscan must be an integer in 0..100");
        if (virtual.label !== undefined && typeof virtual.label !== "string") fail("UIF_DOCUMENT_VIRTUAL", path, "label must be a string");
      }
      visit(record.template, `${path}.template`, depth + 1, true);
      return;
    }
    keys(record, ["type", "key", "props", "on", "children"], path);
    if (!nodeTypes.has(record.type as NodeType)) fail("UIF_DOCUMENT_TYPE", `${path}.type`, "unsupported node type");
    const nodeProps = record.props === undefined ? {} : object(record.props, `${path}.props`);
    for (const [key, value] of Object.entries(nodeProps)) {
      const location = `${path}.props.${key}`;
      if (!props.has(key)) fail("UIF_DOCUMENT_PROP", location, "unsupported property");
      if (["style", "attrs", "navigation"].includes(key)) {
        const map = object(value, location);
        for (const [name, child] of Object.entries(map)) {
          if (key === "attrs" && (!/^(aria|data)-[a-z][a-z0-9-]*$/.test(name) || name.startsWith("data-uif-"))) fail("UIF_DOCUMENT_ATTRIBUTE", location, `unsupported attribute ${name}`);
          if (key === "navigation" && (!["left", "right", "up", "down", "next", "previous"].includes(name) || typeof child !== "string")) fail("UIF_DOCUMENT_NAVIGATION", location, "navigation maps directions to literal IDs");
          if (key === "style" && (!/^(--[a-z][\w-]*|[a-zA-Z][\w-]*)$/.test(name) || typeof child === "string" && /url\s*\(|expression\s*\(|@import|javascript:/i.test(child))) fail("UIF_DOCUMENT_STYLE", location, "invalid style name or resource-bearing style; use image.src for assets");
          if (!binding(child) && child !== null && !["string", "number", "boolean"].includes(typeof child)) fail("UIF_DOCUMENT_VALUE", `${location}.${name}`, "expected a scalar or binding");
          if (key === "style" && typeof child === "boolean") fail("UIF_DOCUMENT_STYLE", location, "style values cannot be boolean");
          validateValue(child, `${location}.${name}`);
        }
      } else {
        validateValue(value, location);
        if (binding(value)) { if (staticProps.has(key)) fail("UIF_DOCUMENT_STATIC", location, "must be literal"); }
        else if (booleanProps.has(key) && typeof value !== "boolean" || numberProps.has(key) && typeof value !== "number" || stringProps.has(key) && typeof value !== "string") fail("UIF_DOCUMENT_VALUE", location, "incorrect property value type");
        if (key === "inputType" && !["text", "password", "email", "search", "tel", "url", "number"].includes(value as string)) fail("UIF_DOCUMENT_VALUE", location, "unsupported inputType");
        if (key === "dir" && !binding(value) && !["ltr", "rtl", "auto"].includes(value as string)) fail("UIF_DOCUMENT_VALUE", location, "unsupported direction");
        if (key === "players" && !binding(value) && (!Array.isArray(value) || value.some(player => !Number.isInteger(player) || player < 0))) fail("UIF_DOCUMENT_PLAYERS", location, "expected non-negative integer player indices");
      }
    }
    if (nodeProps.id !== undefined) {
      if (repeated) fail("UIF_DOCUMENT_ID", `${path}.props.id`, "static IDs are forbidden in repeated templates; use generated runtime IDs");
      const id = String(nodeProps.id);
      if (!id || ids.has(id)) fail("UIF_DOCUMENT_ID", `${path}.props.id`, "ID must be nonempty and unique throughout the asset");
      ids.add(id);
    }
    if (record.on !== undefined) {
      const handlers = object(record.on, `${path}.on`);
      for (const [name, handler] of Object.entries(handlers)) {
        if (!events.has(name as UIEventType)) fail("UIF_DOCUMENT_EVENT", `${path}.on.${name}`, "unsupported event");
        if (typeof handler === "string") { if (!handler) fail("UIF_DOCUMENT_ACTION", path, "empty action"); }
        else {
          const action = object(handler, `${path}.on.${name}`);
          keys(action, ["action", "args"], `${path}.on.${name}`);
          if (typeof action.action !== "string" || !action.action) fail("UIF_DOCUMENT_ACTION", path, "action name is required");
          if (action.args !== undefined) for (const [key, value] of Object.entries(object(action.args, `${path}.on.${name}.args`))) validateValue(value, `${path}.on.${name}.args.${key}`);
        }
      }
    }
    if (record.children !== undefined) {
      if (!Array.isArray(record.children)) fail("UIF_DOCUMENT_CHILDREN", path, "expected array");
      if (["input", "textarea", "image", "progress", "slider", "toggle"].includes(record.type as string) && record.children.length) fail("UIF_DOCUMENT_CHILDREN", path, "leaf cannot have children");
      if (nodeProps.text !== undefined && record.children.length) fail("UIF_DOCUMENT_CHILDREN", path, "text and children are mutually exclusive");
      const siblingKeys = new Set<unknown>();
      record.children.forEach((child, index) => {
        if (child && typeof child === "object" && "key" in child) {
          if (siblingKeys.has(child.key)) fail("UIF_DOCUMENT_KEY", `${path}.children.${index}`, "duplicate sibling key");
          siblingKeys.add(child.key);
        }
        visit(child, `${path}.children.${index}`, depth + 1, repeated);
      });
    }
  };
  visit(document.root, "$.root", 0, false);
  // Own a detached immutable copy; later mutation of a loader override cannot alter a mounted asset.
  const result = JSON.parse(JSON.stringify(source)) as UIDocument;
  const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(result);
  return result;
}

type Locals = Readonly<Record<string, Readable<unknown>>>;
export function compileDocument(input: UIDocument | unknown, bindings: DocumentBindings): Child {
  const document = parseDocument(input);
  // Validate all references, including inactive branches and repeated templates, before mounting any DOM.
  const preflight = (value: unknown, path: string, nodePosition = false): void => {
    if (!value || typeof value !== "object") return;
    if (binding(value) && value.format && !Object.prototype.hasOwnProperty.call(bindings.formatters ?? {}, value.format)) fail("UIF_DOCUMENT_FORMAT", path, `unregistered formatter ${value.format}`);
    const record = value as Record<string, unknown>;
    if (nodePosition && typeof record.component === "string") {
      if (!Object.prototype.hasOwnProperty.call(bindings.components ?? {}, record.component)) fail("UIF_DOCUMENT_COMPONENT", path, `unregistered component ${record.component}`);
      for (const [event, action] of Object.entries(record.events as Record<string, string> ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(bindings.componentActions ?? {}, action)) fail("UIF_DOCUMENT_COMPONENT_ACTION", `${path}.events.${event}`, `unregistered component action ${action}`);
      }
    }
    if (nodePosition && typeof record.type === "string" && record.on) for (const [event, definition] of Object.entries(record.on as object)) {
      const name = typeof definition === "string" ? definition : (definition as { action: string }).action;
      if (!Object.prototype.hasOwnProperty.call(bindings.actions ?? {}, name)) fail("UIF_DOCUMENT_ACTION", `${path}.on.${event}`, `unregistered action ${name}`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (nodePosition && key === "children" && Array.isArray(child)) child.forEach((node, index) => preflight(node, `${path}.children.${index}`, true));
      else preflight(child, `${path}.${key}`, nodePosition && ["then", "else", "template"].includes(key));
    }
  };
  preflight(document.root, "$.root", true);
  const value = (input: unknown, locals: Locals): unknown => {
    if (!binding(input)) return input;
    const parts = pathSegments(input.$bind);
    const local = Object.prototype.hasOwnProperty.call(locals, parts[0]) ? locals[parts[0]] : undefined;
    const source: Value<unknown> = local ? () => getPath(local.get(), parts.slice(1)) : bindings.model.select(input.$bind);
    const format = input.format ? bindings.formatters![input.format] : undefined;
    return () => {
      let result = read(source);
      if (result === undefined) result = input.fallback;
      return format ? format(result) : result;
    };
  };
  const compile = (node: DocumentNode, locals: Locals): Child => {
    if (typeof node === "string" || typeof node === "number") return node;
    if ("when" in node) {
      const condition = value(node.when, locals) as Value<boolean>;
      // Cache descriptions; changing a branch does not recompile paths on every update.
      const then = compile(node.then, locals), otherwise = node.else === undefined ? null : compile(node.else, locals);
      return dynamic(() => read(condition) ? then : otherwise, node.key);
    }
    if ("each" in node) {
      const items = value(node.each, locals) as Value<readonly unknown[]>;
      const parts = pathSegments(node.itemKey);
      const itemKey = (item: unknown) => getPath(item, parts) as string | number;
      const render = (item: Readable<unknown>, index: Readable<number>) => compile(node.template, { ...locals, [node.as]: item, $index: index });
      return node.virtual ? virtualList({ items, itemKey, render, key: node.key, ...node.virtual, props: { label: node.virtual.label } }) : each(items, itemKey, render, node.key);
    }
    const props: Record<string, unknown> = { key: node.key };
    for (const [key, source] of Object.entries(node.props ?? {})) {
      if (["style", "attrs"].includes(key)) props[key] = Object.fromEntries(Object.entries(source as object).map(([name, source]) => [name, value(source, locals)]));
      else props[key] = value(source, locals);
    }
    if ("component" in node) {
      const events = Object.fromEntries(Object.entries(node.events ?? {}).map(([event, action]) => [event, (detail: unknown) => bindings.componentActions![action](detail)]));
      return bindings.components![node.component]({ ...props, key: node.key, state: value(node.state, locals), events });
    }
    const on: EventHandlers = {};
    for (const [event, definition] of Object.entries(node.on ?? {})) {
      const action = typeof definition === "string" ? definition : definition.action;
      const args = typeof definition === "string" ? undefined : Object.fromEntries(Object.entries(definition.args ?? {}).map(([key, arg]) => [key, value(arg, locals)]));
      on[event as UIEventType] = event => bindings.actions![action](event, args && Object.fromEntries(Object.entries(args).map(([key, source]) => [key, read(source)])));
    }
    props.on = on;
    return h(node.type, props as Props, ...(node.children ?? []).map(child => compile(child, locals)));
  };
  return compile(document.root, {});
}

export interface DocumentHandle {
  readonly document: UIDocument;
  /** Validation failure leaves the existing view unchanged. User formatter/runtime exceptions are not rollback transactions. */
  reload(input: unknown): boolean;
}
export function mountDocument(ui: UIFinal, input: unknown, bindings: DocumentBindings): DocumentHandle {
  let document = parseDocument(input);
  ui.mount(compileDocument(document, bindings));
  return {
    get document() { return document; },
    reload(input) {
      let next: UIDocument, child: Child;
      try { next = parseDocument(input); child = compileDocument(next, bindings); }
      catch (error) { ui.report(error); return false; }
      try { ui.update(child); document = next; return true; }
      catch (error) { ui.report(error); return false; }
    },
  };
}
