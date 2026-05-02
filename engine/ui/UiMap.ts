import type { BoxConfig } from "yage/ui/Box";
import { Box } from "yage/ui/Box";
import { Position } from "yage/ui/Rectangle";
import type { UIElement, UIElementConfig } from "yage/ui/UIElement";
import { UIService } from "yage/ui/UIService";
import type { UIConfig } from "yage/ui/UiConfigs";
import { createByType } from "yage/ui/UiConfigs";
import { cloneDeep, get, isEqual, merge } from "lodash";
import type { LayoutNodeConfig, LayoutResult } from "yage/ui/layout";
import { computeLayout } from "yage/ui/layout";
import { createTextMeasurer, isPosspecFormat } from "yage/ui/layout/LayoutRenderer";

export type UiMap = {
  build: (
    context: any,

    eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
  ) => { [key: string]: UIElement<any> };
  update: (context: any) => void;
  context: () => any;
};

type Query = {
  query: string;
  key: string;
  parent: string;
  partial?: {
    source: string;
    start: number;
    end: number;
  };
  pointer: string | ((nextValue: any) => boolean);
  /** Expression info for {{ }} syntax */
  expression?: {
    source: string;
    deps: string[];
    evaluate: (ctx: any) => any;
  };
};

type BuildQuery = [UIElement<any> | null, Query[]];

type BuiltContext = BuildQuery[];

// ─── Feature flag (kill switch for granular reactivity) ───────────────────────
export let USE_UIMAP_GRANULAR_REACTIVITY = false;
export const setUiMapGranularReactivity = (enabled: boolean) => {
  USE_UIMAP_GRANULAR_REACTIVITY = enabled;
};

// ─── Expression evaluation engine ────────────────────────────────────────────

const EXPRESSION_RE = /\{\{(.*?)\}\}/g;

/** Blocked globals for expression sandboxing */
const BLOCKED_GLOBALS = ["window", "document", "eval", "Function", "globalThis", "self", "top", "parent", "frames"];

/** Cache compiled expression functions for performance */
const expressionCache = new Map<string, (ctx: any) => any>();

/**
 * Extract variable dependency names from an expression string.
 * Returns top-level identifier names (e.g. "player.hp" → "player").
 */
const extractDeps = (expr: string): string[] => {
  // Match identifiers that are NOT preceded by . (i.e., not property accesses)
  const identRe = /(?<![.\w$])([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  const deps = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = identRe.exec(expr)) !== null) {
    const name = m[1];
    // Skip JS keywords, literals, and blocked globals
    if (
      ![
        "true",
        "false",
        "null",
        "undefined",
        "NaN",
        "Infinity",
        "typeof",
        "instanceof",
        "void",
        "in",
        "of",
        "new",
        "delete",
        "this",
      ].includes(name) &&
      !BLOCKED_GLOBALS.includes(name)
    ) {
      deps.add(name);
    }
  }
  return [...deps];
};

/**
 * Compile a single expression body into a sandboxed evaluator function.
 * Uses `new Function` with blocked globals set to undefined.
 */
const compileExpression = (exprBody: string): ((ctx: any) => any) => {
  if (expressionCache.has(exprBody)) {
    return expressionCache.get(exprBody)!;
  }
  try {
    // Build a function that uses `with(ctx)` to resolve variables from the context.
    // NOTE: `with` is forbidden in strict mode, so we must NOT use "use strict" here.
    // Blocked globals are shadowed as function parameters set to undefined.
    const fn = new Function(
      "ctx",
      ...BLOCKED_GLOBALS,
      `try {
        with (ctx) { return (${exprBody}); }
      } catch(e) {
        return undefined;
      }`
    ) as (ctx: any, ...args: any[]) => any;

    // Wrap so callers don't need to pass the blocker args
    const wrapped = (ctx: any) => fn(ctx);
    expressionCache.set(exprBody, wrapped);
    return wrapped;
  } catch {
    // If the expression can't compile, return a no-op
    const noop = () => undefined;
    expressionCache.set(exprBody, noop);
    return noop;
  }
};

/**
 * Evaluate a string that may contain {{ expr }} interpolations against a context.
 * Returns the resolved value. If the entire string is a single {{ expr }}, returns
 * the raw evaluated value (preserving type). Otherwise returns a string.
 */
const evaluateTemplate = (template: string, ctx: any): any => {
  // Fast path: no expressions
  if (!template.includes("{{")) {
    return template;
  }
  const matches = [...template.matchAll(/\{\{(.*?)\}\}/g)];
  // Preserve type only when the template is exactly one interpolation.
  if (matches.length === 1 && matches[0][0] === template) {
    const fn = compileExpression(matches[0][1].trim());
    const result = fn(ctx);
    return result === undefined ? "" : result;
  }
  // Multiple interpolations: replace each and concatenate as string
  // Use a fresh local regex to avoid global lastIndex issues
  const localRe = /\{\{(.*?)\}\}/g;
  return template.replace(localRe, (_, expr) => {
    const fn = compileExpression(expr.trim());
    const result = fn(ctx);
    return result === undefined ? "" : String(result);
  });
};

/**
 * Check if a string contains {{ }} expression syntax.
 */
const hasExpression = (value: string): boolean => {
  EXPRESSION_RE.lastIndex = 0;
  const result = EXPRESSION_RE.test(value);
  EXPRESSION_RE.lastIndex = 0;
  return result;
};

// ─── Inline CSS string parsing ───────────────────────────────────────────────

/**
 * Convert a kebab-case CSS property name to camelCase.
 * e.g. "background-color" → "backgroundColor"
 */
const kebabToCamel = (str: string): string => {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
};

/**
 * Parse a CSS style string into a camelCase style object.
 * Supports {{ expr }} inside values.
 */
const parseCssString = (cssString: string, ctx: any): Partial<CSSStyleDeclaration> => {
  const style: any = {};
  // First evaluate any expressions in the string
  const resolved =
    typeof cssString === "string" && cssString.includes("{{") ? evaluateTemplate(cssString, ctx) : cssString;

  if (typeof resolved !== "string") {
    return style;
  }

  const declarations = resolved.split(";").filter((s) => s.trim());
  for (const decl of declarations) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const val = decl.slice(colonIdx + 1).trim();
    if (prop && val) {
      style[kebabToCamel(prop)] = val;
    }
  }
  return style;
};

// ─── Structural node detection ───────────────────────────────────────────────

const isStructuralNode = (value: any): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return "$if" in value || "$unless" in value || "$with" in value || "$partial" in value || "$each" in value || "$breakpoint" in value;
};

const generateEventListener = (
  events: any,
  contextRef: any,
  eventListener: (playerIndex: number, eventName: any, eventType: any, eventData: any, payload?: any) => void
) => {
  return events
    ? {
        onEscape: (playerIndex: number) => {
          if (events.escape) {
            eventListener(playerIndex, events.escape, "escape", contextRef.context);
          }
        },
        onClick: (playerIndex: number) => {
          if (events.click) {
            eventListener(playerIndex, events.click, "click", contextRef.context);
          }
          if (events.trigger) {
            eventListener(playerIndex, events.trigger, "trigger", contextRef.context);
          }
          return false;
        },
        onMouseDown: (playerIndex: number) => {
          if (events.mouseDown) {
            eventListener(playerIndex, events.mouseDown, "mouseDown", contextRef.context);
          }
          return false;
        },
        onMouseUp: (playerIndex: number) => {
          if (events.mouseUp) {
            eventListener(playerIndex, events.mouseUp, "mouseUp", contextRef.context);
          }
          return false;
        },
        onMouseEnter: (playerIndex: number) => {
          if (events.mouseEnter) {
            eventListener(playerIndex, events.mouseEnter, "mouseEnter", contextRef.context);
          }
          if (events.hoverFocus) {
            eventListener(playerIndex, events.hoverFocus, "hoverFocus", contextRef.context);
          }
        },
        onMouseLeave: (playerIndex: number) => {
          if (events.mouseLeave) {
            eventListener(playerIndex, events.mouseLeave, "mouseLeave", contextRef.context);
          }
          if (events.hoverBlur) {
            eventListener(playerIndex, events.hoverBlur, "hoverBlur", contextRef.context);
          }
        },
        onBlur: (playerIndex: number) => {
          if (events.blur) {
            eventListener(playerIndex, events.blur, "blur", contextRef.context);
          }
        },
        onFocus: (playerIndex: number) => {
          if (events.focus) {
            eventListener(playerIndex, events.focus, "focus", contextRef.context);
          }
        },
        onChange: (value: string) => {
          if (events.change) {
            eventListener(0, events.change, "change", contextRef.context, value);
          }
        },
        onSubmit: (value: string) => {
          if (events.submit) {
            eventListener(0, events.submit, "submit", contextRef.context, value);
          }
        },
      }
    : {};
};

const registeredClasses = new Map<string, Partial<CSSStyleDeclaration>>();
export const registerUiClass = (className: string, styles: Partial<CSSStyleDeclaration>) => {
  registeredClasses.set(className, styles);
};
const registeredTemplates = new Map<string, any>();
export const registerTemplate = (templateName: string, template: any) => {
  registeredTemplates.set(templateName, template);
};

const rebaseRectToWrapper = (rect: any = {}) => ({
  ...rect,
  x: "left",
  y: "top",
  xOffset: 0,
  yOffset: 0,
});

const testQuery = (key: string, value: string, json: string, parent: string): Query | undefined => {
  if (value.includes("$$")) {
    const test = /(\$\$[a-zA-Z0-9_.]+)/g;
    const match = test.exec(value);

    if (!match) {
      return;
    }
    if (match[0].length === value.length) {
      return {
        query: value.slice(2),
        key,
        parent,
        pointer: json,
      };
    }
    const partial = {
      source: value,
      start: match.index,
      end: match[0].length + match.index,
    };
    return {
      query: value.slice(partial.start + 2, partial.end),
      key: key,
      parent: parent,
      partial,
      pointer: json,
    };
  }
};

/**
 * Test if a string value contains {{ expr }} syntax and return a Query for it.
 * The query uses the expression engine instead of simple variable lookup.
 */
const testExpressionQuery = (key: string, value: string, json: any, parent: string): Query | undefined => {
  EXPRESSION_RE.lastIndex = 0;
  if (!hasExpression(value)) {
    EXPRESSION_RE.lastIndex = 0;
    return;
  }
  EXPRESSION_RE.lastIndex = 0;

  // Collect all deps from all {{ }} blocks in this string
  const allDeps: string[] = [];
  let m: RegExpExecArray | null;
  const re = /\{\{(.*?)\}\}/g;
  while ((m = re.exec(value)) !== null) {
    allDeps.push(...extractDeps(m[1].trim()));
  }

  // Use the first dep as the "query" key for compatibility, but the expression
  // system doesn't actually use lodash get — it evaluates the full expression.
  const primaryDep = allDeps[0] || "";

  return {
    query: primaryDep,
    key,
    parent,
    pointer: json,
    expression: {
      source: value,
      deps: [...new Set(allDeps)],
      evaluate: (ctx: any) => evaluateTemplate(value, ctx),
    },
  };
};

const remapTemplateQueries = (json: any, contextMap: any, parent = "") => {
  Object.entries(json).forEach(([key, value]: [string, any]) => {
    if (typeof value === "string") {
      const query = testQuery(key, value, json, parent);
      if (query) {
        // const query = value.slice(2);
        if (!query.partial) {
          const contextValue = contextMap[query.query];
          if (contextValue !== undefined) {
            json[key] = contextValue;
          }
        } else {
          const contextValue = contextMap[query.query];
          if (contextValue !== undefined) {
            json[key] =
              query.partial.source.slice(0, query.partial.start) +
              contextValue +
              query.partial.source.slice(query.partial.end);
          }
        }
        // const contextValue = contextMap[query];
        // if (contextValue !== undefined) {
        //   json[key] = contextValue;
        // }
      }
    } else if (Array.isArray(value)) {
      value.map((v) => remapTemplateQueries(v, contextMap, parent ? `${parent}.${key}` : key));
    } else if (typeof value === "object") {
      remapTemplateQueries(value, contextMap);
    }
  });
};

export const getUiMapTemplate = (templateName: string, elementName?: string) => {
  if (registeredTemplates.has(templateName)) {
    if (!elementName) {
      return registeredTemplates.get(templateName);
    }
    return registeredTemplates.get(templateName)[elementName];
  }
};

const applyIdSuffix = (value: any, suffix: string): any => {
  if (Array.isArray(value)) {
    return value.map((item) => applyIdSuffix(item, suffix));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const cloned = { ...value };
  if (typeof cloned.id === "string") {
    cloned.id = `${cloned.id}${suffix}`;
  }

  if (cloned.children) cloned.children = applyIdSuffix(cloned.children, suffix);
  if (cloned.content) cloned.content = applyIdSuffix(cloned.content, suffix);
  if (cloned.then) cloned.then = applyIdSuffix(cloned.then, suffix);
  if (cloned.else) cloned.else = applyIdSuffix(cloned.else, suffix);
  if (cloned.element) cloned.element = applyIdSuffix(cloned.element, suffix);

  return cloned;
};

const assignPosspecIds = (value: any, path = "root"): any => {
  if (Array.isArray(value)) {
    return value.map((item, index) => assignPosspecIds(item, `${path}-${index}`));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const cloned = { ...value };
  if (cloned.type && !cloned.id) {
    cloned.id = path;
  }

  if (cloned.children) cloned.children = assignPosspecIds(cloned.children, `${path}-children`);
  if (cloned.content) cloned.content = assignPosspecIds(cloned.content, `${path}-content`);
  if (cloned.then) cloned.then = assignPosspecIds(cloned.then, `${path}-then`);
  if (cloned.else) cloned.else = assignPosspecIds(cloned.else, `${path}-else`);
  if (cloned.$breakpoint) {
    cloned.$breakpoint = {
      ...cloned.$breakpoint,
      landscape: assignPosspecIds(cloned.$breakpoint.landscape, `${path}-landscape`),
      portrait: assignPosspecIds(cloned.$breakpoint.portrait, `${path}-portrait`),
    };
  }
  if (cloned.element) cloned.element = assignPosspecIds(cloned.element, `${path}-element`);

  return cloned;
};

const resolvePosspecValue = (value: any, ctx: any): any => {
  if (typeof value === "string") {
    if (value.includes("{{")) {
      return evaluateTemplate(value, ctx);
    }
    if (value.includes("$$")) {
      const match = /^(\$\$[a-zA-Z0-9_.]+)$/.exec(value);
      if (match) {
        return get(ctx, value.slice(2));
      }
      return value.replace(/(\$\$[a-zA-Z0-9_.]+)/g, (token) => {
        const resolved = get(ctx, token.slice(2));
        return resolved === undefined ? "" : String(resolved);
      });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePosspecValue(item, ctx));
  }
  if (value && typeof value === "object") {
    const resolved: any = {};
    for (const [key, next] of Object.entries(value)) {
      resolved[key] = resolvePosspecValue(next, ctx);
    }
    return resolved;
  }
  return value;
};

const resolvePosspecNodes = (value: any, ctx: any, rootCtx: any): any[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => resolvePosspecNodes(item, ctx, rootCtx));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  if (value.$if !== undefined || value.$unless !== undefined) {
    const raw = compileExpression(String(value.$if ?? value.$unless))(ctx);
    const pass = value.$if !== undefined ? !!raw : !raw;
    return pass ? resolvePosspecNodes(value.then, ctx, rootCtx) : resolvePosspecNodes(value.else, ctx, rootCtx);
  }

  if (value.$with !== undefined) {
    const scoped = get(ctx, value.$with);
    if (!scoped || typeof scoped !== "object") {
      return [];
    }
    return resolvePosspecNodes(value.content, { ...scoped, $root: rootCtx }, rootCtx);
  }

  if (value.$breakpoint !== undefined) {
    const bp = value.$breakpoint;
    const isPortrait = typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false;
    const branch = isPortrait ? bp.portrait : bp.landscape;
    return branch ? resolvePosspecNodes(branch, ctx, rootCtx) : [];
  }

  if (value.$each !== undefined) {
    const items = get(ctx, value.$each) ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return resolvePosspecNodes(value.else, ctx, rootCtx);
    }
    return items.flatMap((item, index) => {
      const itemCtx = { ...ctx, ...cloneDeep(item), $context: ctx, $index: index, $root: rootCtx };
      return resolvePosspecNodes(applyIdSuffix(cloneDeep(value.content), `-${index}`), itemCtx, rootCtx);
    });
  }

  if (!value.type) {
    return Object.values(value).flatMap((item) => resolvePosspecNodes(item, ctx, rootCtx));
  }

  const resolvedNode: any = resolvePosspecValue(value, ctx);
  resolvedNode.__eventContext = ctx;
  if (resolvedNode.children) {
    resolvedNode.children = resolvePosspecNodes(value.children, ctx, rootCtx);
  }
  if (resolvedNode.items && value.element) {
    const items = resolvedNode.items;
    resolvedNode.children = Array.isArray(items)
      ? items.flatMap((item: any, index: number) => {
          const itemCtx = { ...ctx, ...cloneDeep(item), $context: ctx, $index: index, $root: rootCtx };
          return resolvePosspecNodes(applyIdSuffix(cloneDeep(value.element), `-${index}`), itemCtx, rootCtx);
        })
      : [];
  }

  return [resolvedNode];
};

const applyPosspecLayoutResult = (result: LayoutResult, parentResult?: LayoutResult) => {
  const nodeId = (result.node as any).id;
  if (nodeId) {
    const element = UIService.getInstance().mappedIds[nodeId];
    if (element) {
      (element as any)._config.style.position = "absolute";
      const relativeX = parentResult ? result.bounds.x - parentResult.bounds.x : result.bounds.x;
      const relativeY = parentResult ? result.bounds.y - parentResult.bounds.y : result.bounds.y;
      (element.config as any).layoutRect = {
        x: relativeX,
        y: relativeY,
        width: result.bounds.width,
        height: result.bounds.height,
      };
      (element.config as any).layoutScale = result.scaleFactor;
    }
  }
  result.children.forEach((child) => applyPosspecLayoutResult(child, result));
};

const clearPosspecLayoutRects = (element: UIElement<any>) => {
  const config = element.config as any;
  if (config.layoutRect !== undefined) {
    config.layoutRect = undefined;
  }
  if (config.layoutScale !== undefined) {
    config.layoutScale = undefined;
  }
  element.getChildren()?.forEach((child) => clearPosspecLayoutRects(child));
};

const posspecElementType = (nodeType: string): UIConfig["type"] => {
  switch (nodeType) {
    case "Text":
      return "text";
    case "Button":
      return "button";
    case "Input":
      return "input";
    case "Image":
      return "image";
    default:
      return "box";
  }
};

const buildPosspecElementConfig = (
  node: any,
  contextRef: { context: any },
  eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
) => {
  const styles = { ...(node.styles ?? {}) };
  if (
    styles.pointerEvents === undefined &&
    ["Canvas", "VStack", "HStack", "Grid", "Box", "Input"].includes(node.type)
  ) {
    styles.pointerEvents = "auto";
  }
  const fontSize = styles.fontSize !== undefined ? parseFloat(String(styles.fontSize)) : undefined;
  delete styles.fontSize;

  const config: any = {
    style: styles,
  };

  if (node.testId !== undefined) {
    config.testId = node.testId;
  }
  if (node.focusStyle !== undefined) {
    config.focusStyle = { ...node.focusStyle };
  }
  if (node.hoverStyle !== undefined) {
    config.hoverStyle = { ...node.hoverStyle };
  }

  if (node.focusable !== undefined) {
    config.focusable = node.focusable;
  }
  if (node.autoFocus !== undefined) {
    config.autoFocus = node.autoFocus;
  }
  if (node.captureFocus !== undefined) {
    config.captureFocus = node.captureFocus;
  }
  if (node.visible !== undefined) {
    config.visible = node.visible;
  }

  if (fontSize !== undefined && !Number.isNaN(fontSize)) {
    config.fontSize = fontSize;
  }
  if (node.text !== undefined) config.label = node.text;
  if (node.label !== undefined) config.label = node.label;
  if (node.texture !== undefined) config.imageKey = node.texture;
  if (node.value !== undefined) config.value = node.value;
  if (node.disabled !== undefined) config.disabled = node.disabled;

  if (node.events) {
    const eventContextRef = { context: node.__eventContext ?? contextRef.context };
    Object.assign(config, generateEventListener(node.events, eventContextRef, eventHandler));
  }

  return config;
};

const createPosspecElement = (
  node: any,
  contextRef: { context: any },
  eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
) => {
  const element = createByType({
    type: posspecElementType(node.type),
    rect: new Position(0, 0, { width: 0, height: 0 }),
    config: buildPosspecElementConfig(node, contextRef, eventHandler),
  });
  if (node.id) {
    element.id = node.id;
  }
  return element;
};

const applyPosspecNodeToElement = (
  element: UIElement<any>,
  node: any,
  contextRef: { context: any },
  eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
) => {
  const config = buildPosspecElementConfig(node, contextRef, eventHandler);
  if (!isEqual(element.config.style, config.style ?? {})) {
    element.config.style = config.style ?? {};
  }
  if (config.focusStyle !== undefined) {
    if (!isEqual(element.config.focusStyle, config.focusStyle)) {
      element.config.focusStyle = config.focusStyle;
    }
  }
  if (config.hoverStyle !== undefined) {
    if (!isEqual((element.config as any).hoverStyle, config.hoverStyle)) {
      (element.config as any).hoverStyle = config.hoverStyle;
    }
  }
  if (config.focusable !== undefined) {
    if (element.config.focusable !== config.focusable) {
      element.config.focusable = config.focusable;
    }
  }
  if (config.autoFocus !== undefined) {
    if (element.config.autoFocus !== config.autoFocus) {
      element.config.autoFocus = config.autoFocus;
    }
  }
  if (config.captureFocus !== undefined) {
    if (element.config.captureFocus !== config.captureFocus) {
      element.config.captureFocus = config.captureFocus;
    }
  }
  if (config.visible !== undefined) {
    if (element.config.visible !== config.visible) {
      element.config.visible = config.visible;
    }
  }
  if (config.testId !== undefined) {
    if (element.config.testId !== config.testId) {
      element.config.testId = config.testId;
    }
  }

  if (config.fontSize !== undefined) {
    if ((element.config as any).fontSize !== config.fontSize) {
      (element.config as any).fontSize = config.fontSize;
    }
  }
  if (config.label !== undefined) {
    if ((element.config as any).label !== config.label) {
      (element.config as any).label = config.label;
    }
  }
  if (config.imageKey !== undefined) {
    if ((element.config as any).imageKey !== config.imageKey) {
      (element.config as any).imageKey = config.imageKey;
    }
  }
  if (config.value !== undefined) {
    if ((element.config as any).value !== config.value) {
      (element.config as any).value = config.value;
    }
  }
  if (config.disabled !== undefined) {
    if ((element.config as any).disabled !== config.disabled) {
      (element.config as any).disabled = config.disabled;
    }
  }
  const eventKeys = [
    "onEscape",
    "onClick",
    "onMouseDown",
    "onMouseUp",
    "onMouseEnter",
    "onMouseLeave",
    "onBlur",
    "onFocus",
    "onChange",
    "onSubmit",
  ] as const;
  eventKeys.forEach((key) => {
    if (config[key] !== undefined) {
      if ((element.config as any)[key] !== config[key]) {
        (element.config as any)[key] = config[key];
      }
    }
  });
  if (node.id && element.id !== node.id) {
    element.id = node.id;
  }
};

const syncPosspecSubtree = (
  parent: UIElement<any>,
  nodes: any[],
  contextRef: { context: any },
  eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
) => {
  const existingChildren = [...(parent.getChildren() ?? [])];
  const nextChildren: UIElement<any>[] = [];
  const used = new Set<UIElement<any>>();

  nodes.forEach((node, index) => {
    let element =
      existingChildren[index] &&
      !used.has(existingChildren[index]) &&
      existingChildren[index].id === node.id
        ? existingChildren[index]
        : existingChildren.find((child) => !used.has(child) && child.id === node.id);

    if (!element) {
      element = createPosspecElement(node, contextRef, eventHandler);
    } else {
      applyPosspecNodeToElement(element, node, contextRef, eventHandler);
    }

    used.add(element);
    syncPosspecSubtree(element, node.children ?? [], contextRef, eventHandler);
    nextChildren.push(element);
  });

  existingChildren.forEach((child) => {
    if (!used.has(child) && !child.destroyed) {
      child.onDestroy(true);
    }
  });

  const childrenChanged =
    existingChildren.length !== nextChildren.length ||
    existingChildren.some((child, index) => child !== nextChildren[index]);

  (parent.config as any).children = nextChildren;
  nextChildren.forEach((child) => {
    if (child.parent !== parent) {
      child.parent = parent;
    }
  });
  if (childrenChanged) {
    parent.update();
  }
};

const buildPosspecSubtree = (
  parent: UIElement<any>,
  nodes: any[],
  contextRef: { context: any },
  eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
) => {
  nodes.forEach((node) => {
    const element = createPosspecElement(node, contextRef, eventHandler);
    parent.addChild(element);
    if (node.children?.length) {
      buildPosspecSubtree(element, node.children, contextRef, eventHandler);
    }
  });
};

const createPosspecHost = (id: string) => {
  const host = new Box(new Position("left", "top", { width: "full", height: "full" }), {
    style: {
      position: "absolute",
      backgroundColor: "transparent",
      border: "none",
      padding: "0",
      margin: "0",
      overflow: "visible",
      pointerEvents: "auto",
    },
    pointerEventsOnOverflow: false,
  });
  host.id = id;
  return host;
};

const populatePosspecHost = (
  host: UIElement<any>,
  nodes: any[],
  contextRef: { context: any },
  eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
) => {
  syncPosspecSubtree(host, nodes, contextRef, eventHandler);
};

export const buildUiMap = (json: any, boxPosition?: Position, boxConfig?: Partial<BoxConfig>): UiMap => {
  json = cloneDeep(json);
  const posspecJson = isPosspecFormat(json)
    ? Object.fromEntries(
        Object.entries(cloneDeep(json)).map(([key, value]) => [key, assignPosspecIds(value, key)])
      )
    : null;
  const measureText = posspecJson ? createTextMeasurer() : null;

  if (posspecJson && measureText) {
    let buildContext: any = null;
    let rootContext: any = null;
    let builtRoots: { [key: string]: UIElement<any> } = {};
    let fontRelayoutRegistered = false;
    let resizeListenerRegistered = false;
    let lastOrientation: "portrait" | "landscape" | null = null;
    let activeEventHandler:
      | ((
          playerIndex: number,
          eventName: string,
          eventType: string,
          context: any,
          payload?: any
        ) => void)
      | null = null;

    const getVirtualViewport = () => {
      if (typeof window !== "undefined" && window.innerHeight > window.innerWidth) {
        return { width: 1080, height: 1920 };
      }
      return { width: 1920, height: 1080 };
    };

    const runPosspecLayout = () => {
      const vp = getVirtualViewport();
      for (const value of Object.values(posspecJson)) {
        const resolvedRoots = resolvePosspecNodes(cloneDeep(value), buildContext, rootContext);
        resolvedRoots.forEach((resolvedRoot) => {
          const layout = computeLayout(resolvedRoot as LayoutNodeConfig, vp.width, vp.height, measureText);
          applyPosspecLayoutResult(layout);
        });
      }
    };

    const buildPosspecRoots = () => {
      if (!activeEventHandler) {
        return {};
      }

      const eventHandler = activeEventHandler;
      const contextRef = { context: buildContext };
      const resolvedRootElements: { [key: string]: UIElement<any> } = {};

      Object.entries(posspecJson).forEach(([key, value]) => {
        const resolvedRoots = resolvePosspecNodes(cloneDeep(value), buildContext, rootContext);
        const host =
          builtRoots[key] && !builtRoots[key].destroyed
            ? builtRoots[key]
            : createPosspecHost(`__posspec_host_${key}`);
        populatePosspecHost(host, resolvedRoots, contextRef, eventHandler);
        resolvedRootElements[key] = host;
      });

      if (boxPosition) {
        const box = builtRoots.box && !builtRoots.box.destroyed ? (builtRoots.box as Box) : new Box(boxPosition, boxConfig);
        box.removeAllChildren();
        Object.values(resolvedRootElements).forEach((element) => {
          box.addChild(element);
        });
        builtRoots = { ...resolvedRootElements, box };
        return builtRoots;
      }

      builtRoots = resolvedRootElements;
      return builtRoots;
    };

    const rebuildPosspecUi = () => {
      const roots = buildPosspecRoots();
      runPosspecLayout();
      return roots;
    };

    const ensurePosspecFontRelayout = () => {
      if (fontRelayoutRegistered || typeof document === "undefined") {
        return;
      }

      const fonts = (document as Document & {
        fonts?: {
          ready?: Promise<unknown>;
          addEventListener?: (type: string, listener: () => void, options?: AddEventListenerOptions) => void;
        };
      }).fonts;

      if (!fonts) {
        fontRelayoutRegistered = true;
        return;
      }

      const rerunLayout = () => {
        if (!activeEventHandler || !buildContext) {
          return;
        }
        rebuildPosspecUi();
      };

      fonts.ready?.then(rerunLayout);
      fonts.addEventListener?.("loadingdone", rerunLayout, { once: true });
      fontRelayoutRegistered = true;
    };

    const ensureResizeRelayout = () => {
      if (resizeListenerRegistered || typeof window === "undefined") {
        return;
      }
      lastOrientation = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
      window.addEventListener("resize", () => {
        if (!activeEventHandler || !buildContext) {
          return;
        }
        const orientation = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
        if (orientation !== lastOrientation) {
          lastOrientation = orientation;
          rebuildPosspecUi();
        }
      });
      resizeListenerRegistered = true;
    };

    const build = (
      context: any,
      eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
    ) => {
      buildContext = cloneDeep(context);
      rootContext = buildContext;
      activeEventHandler = eventHandler;
      const roots = rebuildPosspecUi();
      ensurePosspecFontRelayout();
      ensureResizeRelayout();
      return roots;
    };

    const update = (partialContext: any) => {
      const nextContext = cloneDeep(buildContext);
      Object.keys(partialContext).forEach((key) => {
        nextContext[key] = cloneDeep(partialContext[key]);
      });
      if (isEqual(nextContext, buildContext)) {
        return;
      }
      buildContext = nextContext;
      rootContext = buildContext;
      rebuildPosspecUi();
    };

    const context = () => {
      return cloneDeep(buildContext);
    };

    return { build, update, context };
  }

  const lastContext: BuiltContext = [];
  let buildContext: any = null;
  let rootContext: any = null;
  let builtRoots: { [key: string]: UIElement<any> } = {};

  const runPosspecLayout = () => {
    if (!posspecJson || !measureText) {
      return;
    }

    Object.values(builtRoots).forEach((root) => clearPosspecLayoutRects(root));

    for (const value of Object.values(posspecJson)) {
      const [resolvedRoot] = resolvePosspecNodes(cloneDeep(value), buildContext, buildContext);
      if (!resolvedRoot) {
        continue;
      }
      const isPortrait = typeof window !== "undefined" && window.innerHeight > window.innerWidth;
      const vpW = isPortrait ? 1080 : 1920;
      const vpH = isPortrait ? 1920 : 1080;
      const layout = computeLayout(resolvedRoot as LayoutNodeConfig, vpW, vpH, measureText);
      applyPosspecLayoutResult(layout);
    }
  };

  const build = (
    context: any,
    eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
  ) => {
    buildContext = cloneDeep(context);
    rootContext = buildContext;

    const getQueriables = (json: any, parent = ""): Query[] => {
      return Object.entries(json)
        .map(([key, value]: [string, any]) => {
          if (typeof value === "string") {
            // Check for {{ }} expressions first
            EXPRESSION_RE.lastIndex = 0;
            if (value.includes("{{") && hasExpression(value)) {
              EXPRESSION_RE.lastIndex = 0;
              return testExpressionQuery(key, value, json, parent) || [];
            }
            if (value.includes("$$")) {
              return testQuery(key, value, json, parent) || [];
            }
          } else if (Array.isArray(value)) {
            if (key === "children" || key === "element") {
              return [];
            }
            return value.map((v) => getQueriables(v)).flat();
          } else if (typeof value === "object") {
            if (key === "children" || key === "element") {
              return [];
            }
            return getQueriables(value, parent ? `${parent}.${key}` : key);
          }
          return [];
        })
        .flat();
    };

    const recursiveBuild = (
      json: any,
      parent: {
        addChild: (element: UIElement<any>) => void;
      },
      contextRef: { context: any },
      buildQueries: BuildQuery[]
    ) => {
      Object.entries(json).forEach(([key, value]: [string, any]) => {
        if (typeof value !== "object" || value === null) {
          return;
        }

        // ─── Handle structural nodes ($if, $unless, $with, $partial) ───
        if (isStructuralNode(value)) {
          handleStructuralNode(key, value, parent, contextRef, buildQueries, eventHandler);
          return;
        }

        if (!value.type) {
          return recursiveBuild(value, parent, contextRef, buildQueries);
        }
        if (value.type === "template") {
          const config = cloneDeep(value.config);
          const [template, element] = config.template.split(".");
          delete config.template;
          if (registeredTemplates.has(template)) {
            const elements = element ? [element] : [...Object.keys(registeredTemplates.get(template))];

            elements.forEach((element) => {
              const templateJson = cloneDeep(registeredTemplates.get(template)[element]);
              const templateContext = contextRef.context;
              if (templateJson) {
                if (value.context) {
                  remapTemplateQueries(templateJson, value.context);
                }
                templateJson.config = merge(templateJson.config, config);
                if (value.rect) {
                  templateJson.rect = merge(templateJson.rect, value.rect);
                }
                recursiveBuild({ template: templateJson }, parent, { context: templateContext }, buildQueries);
              }
            });
          }
          return;
        }
        if (value.type === "grid") {
          const gridQueriables = getQueriables(value);
          if (gridQueriables.length) {
            gridQueriables.forEach(
              ({ query, key, pointer, expression }: { query: string; key: string; pointer: any; expression?: any }) => {
                if (expression) {
                  const contextValue = expression.evaluate(contextRef.context);
                  pointer[key] = contextValue;
                  return;
                }
                const contextValue = get(contextRef.context, query);
                if (key === "items") {
                  pointer[key] = contextValue;
                  return;
                }
                if (contextValue !== undefined) {
                  pointer[key] = contextValue;
                }
              }
            );
          }

          const gridPosition = new Position(value.rect.x, value.rect.y, {
            ...value.rect,
          });
          const gridConfig: BoxConfig = {
            ...value.config,
            renderOnScroll: true,
            style: {
              border: "none",
              display: "flex",
              flexWrap: "wrap",
              overflow: "auto",
              padding: "2px",
              alignContent: "flex-start",
              boxSizing: "border-box",
              pointerEvents: "none",
              gap: value.config?.gap || "0",
              ...value.config?.style,
            },
          };
          const grid = new Box(gridPosition, gridConfig);

          gridQueriables.forEach((query) => {
            if (query.key === "items") {
              query.pointer = (_context) => {
                const items = query.expression ? query.expression.evaluate(_context) : get(_context, query.query);
                buildChildren(items);
                return false;
              };
              return;
            }

            query.pointer = (_context) => {
              let contextValue = query.expression ? query.expression.evaluate(_context) : get(_context, query.query);
              if (contextValue !== undefined) {
                if (query.partial) {
                  contextValue =
                    query.partial.source.slice(0, query.partial.start) +
                    contextValue +
                    query.partial.source.slice(query.partial.end);
                }
                if (query.parent === "config" || !query.parent) {
                  // @ts-ignore
                  if (grid.config[query.key] !== contextValue) {
                    // @ts-ignore
                    grid.config[query.key] = contextValue;
                    return true;
                  }
                } else {
                  const parent = get(grid, query.parent);
                  if (parent && parent[query.key] !== contextValue) {
                    parent[query.key] = contextValue;
                    return true;
                  }
                }

                return true;
              }
              return false;
            };
          });
          let childContexts: any[] = [];
          let childQueries: BuildQuery[][] = [];

          const buildChildren = (items: any) => {
            if (!items) {
              return;
            }
            if (childContexts.length > items.length) {
              const childrenToRemove = grid.config.children.splice(items.length);
              childrenToRemove.forEach((child: UIElement<any>) => {
                child.onDestroy(true);
              });
              childContexts = childContexts.slice(0, items.length);
              childQueries = childQueries.slice(0, items.length);
            }
            for (let i = 0; i < items.length; i++) {
              const itemContext = { ...contextRef.context, ...cloneDeep(items[i]) };
              itemContext.$context = contextRef.context;
              itemContext.$index = i;
              itemContext.$root = rootContext;

              if (!childQueries[i]) {
                childQueries[i] = [];
                childContexts[i] = { context: itemContext };
              } else {
                if (isEqual(childContexts[i].context, itemContext)) {
                  continue;
                }
                childQueries[i].forEach(([element, query]) => {
                  query.forEach(({ pointer }) => typeof pointer === "function" && pointer(itemContext));
                });
                childContexts[i].context = itemContext;
                continue;
              }

              const itemJson = {
                ...applyIdSuffix(cloneDeep(value.element), `-${i}`),
                // rect: {
                //   x: 0,
                //   y: 0,
                //   width: "100%",
                //   height: "100%",
                // },
                config: {
                  ...value.element.config,
                  style: {
                    position: "relative",
                    flex: "0 0 auto",
                    pointerEvents: "auto",
                    ...value.element.config?.style,
                  },
                },
              };
              recursiveBuild({ child: itemJson }, grid, childContexts[i], childQueries[i]);
            }
          };

          const queriables: BuildQuery = [grid, gridQueriables];

          buildQueries.push(queriables);

          buildChildren(value.items);

          parent.addChild(grid);

          return;
        }

        value.config = value.config || {};

        // ─── Inline CSS string parsing ─────────────────────────────────
        if (typeof value.config.style === "string") {
          value.config.style = parseCssString(value.config.style, contextRef.context);
        }

        const queriables = getQueriables(value);
        if (queriables.length) {
          queriables.forEach((query) => {
            // eslint-disable-next-line @typescript-eslint/ban-types
            const pointer: Object = query.pointer as Object;
            let contextValue: any;
            if (query.expression) {
              contextValue = query.expression.evaluate(contextRef.context);
            } else {
              contextValue = get(contextRef.context, query.query);
              if (query.partial) {
                contextValue =
                  query.partial.source.slice(0, query.partial.start) +
                  contextValue +
                  query.partial.source.slice(query.partial.end);
              }
            }
            // @ts-ignore
            pointer[query.key] = contextValue;
          });
        }
        const rect = new Position(value.rect.x, value.rect.y, {
          ...value.rect,
        });

        if (value.events) {
          const events = generateEventListener(value.events, contextRef, eventHandler);
          Object.entries(events).forEach(([key, event]) => {
            value.config[key] = event;
          });
        }

        if (value.config.class) {
          const _classes = value.config.class.split(" ");
          const styles = _classes.reduce((acc: CSSStyleDeclaration, className: string) => {
            return { ...acc, ...registeredClasses.get(className) };
          }, {} as CSSStyleDeclaration);

          value.config.style = { ...styles, ...value.config.style };
        }

        const config: UIConfig = {
          type: value.type,
          rect,
          config: value.config,
        };

        const element = createByType(config);
        if (value.id) {
          element.id = value.id;
        }

        queriables.forEach((query) => {
          query.pointer = (_context) => {
            if (query.expression) {
              const contextValue = query.expression.evaluate(_context);

              if (query.parent === "config" || !query.parent) {
                // @ts-ignore
                if (element.config[query.key] !== contextValue) {
                  // @ts-ignore
                  element.config[query.key] = contextValue;
                  return true;
                }
              } else {
                const parent = get(element, query.parent);
                if (parent && parent[query.key] !== contextValue) {
                  parent[query.key] = contextValue;
                  return true;
                }
              }
              return false;
            }

            let contextValue = get(_context, query.query);

            if (query.key === "events") {
              const events = generateEventListener(contextValue, contextRef, eventHandler);
              // Object.assign(config.config, events);
              let shouldUpdate = false;
              Object.entries(events).forEach(([key, value]) => {
                (element.config as any)[key as keyof UIElementConfig] = value;
                shouldUpdate = true;
              });

              return shouldUpdate;
            }

            if (query.partial) {
              contextValue =
                query.partial.source.slice(0, query.partial.start) +
                contextValue +
                query.partial.source.slice(query.partial.end);
            }

            if (query.parent === "config" || !query.parent) {
              // @ts-ignore
              if (element.config[query.key] !== contextValue) {
                // @ts-ignore
                element.config[query.key] = contextValue;
                return true;
              }
            } else {
              const parent = get(element, query.parent);
              if (parent && parent[query.key] !== contextValue) {
                parent[query.key] = contextValue;
                return true;
              }
            }
            return false;
          };
        });

        if (queriables.length) {
          buildQueries.push([element, queriables]);
        }

        parent.addChild(element);

        if (value.children) {
          recursiveBuild(value.children, element, contextRef, buildQueries);
        }

        return element;
      });
    };

    // ─── Structural node handler ─────────────────────────────────────────
    const handleStructuralNode = (
      key: string,
      value: any,
      parent: { addChild: (element: UIElement<any>) => void },
      contextRef: { context: any },
      buildQueries: BuildQuery[],
      eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any, payload?: any) => void
    ) => {
      const parentIsFlowContainer = (parent as any)?.config?.style?.display === "flex";
      const usingPosspecLayout = !!posspecJson;

      if ("$if" in value || "$unless" in value) {
        const conditionExpr = value.$if || value.$unless;
        const isUnless = "$unless" in value;
        const thenBranch = value.then;
        const elseBranch = value.else;

        if (usingPosspecLayout) {
          let currentBranchQueries: BuildQuery[] = [];
          let currentConditionResult: boolean | null = null;
          let currentBranchRoots: UIElement<any>[] = [];

          const branchParent = {
            addChild: (element: UIElement<any>) => {
              currentBranchRoots.push(element);
              parent.addChild(element);
            },
          };

          const evaluateAndBuild = (ctx: any) => {
            const fn = compileExpression(conditionExpr);
            const rawResult = fn(ctx);
            const conditionResult = isUnless ? !rawResult : !!rawResult;

            if (conditionResult === currentConditionResult) {
              currentBranchQueries.forEach(([, queries]) => {
                queries.forEach(({ pointer }) => {
                  if (typeof pointer === "function") pointer(ctx);
                });
              });
              return false;
            }

            currentConditionResult = conditionResult;

            currentBranchRoots.forEach((child) => child.onDestroy(true));
            currentBranchRoots = [];
            currentBranchQueries = [];

            const branch = conditionResult ? thenBranch : elseBranch;
            if (branch) {
              recursiveBuild({ node: cloneDeep(branch) }, branchParent, contextRef, currentBranchQueries);
            }

            return true;
          };

          evaluateAndBuild(contextRef.context);

          const conditionQuery: Query = {
            query: conditionExpr,
            key: "__$if__",
            parent: "",
            pointer: (_context: any) => evaluateAndBuild(_context),
            expression: {
              source: conditionExpr,
              deps: extractDeps(conditionExpr),
              evaluate: (ctx: any) => compileExpression(conditionExpr)(ctx),
            },
          };

          buildQueries.push([null, [conditionQuery]]);
          return;
        }

        // Create a wrapper box to hold the conditional content
        const wrapperPosition = usingPosspecLayout
          ? new Position(0, 0, {
              width: thenBranch?.rect?.width ?? "auto",
              height: thenBranch?.rect?.height ?? "auto",
            })
          : parentIsFlowContainer
          ? new Position(0, 0, {
              width: thenBranch?.rect?.width ?? "auto",
              height: thenBranch?.rect?.height ?? "auto",
            })
          : thenBranch?.rect
            ? new Position(thenBranch.rect.x ?? 0, thenBranch.rect.y ?? 0, {
                width: thenBranch.rect.width ?? 0,
                height: thenBranch.rect.height ?? 0,
                ...thenBranch.rect,
              })
            : new Position(0, 0, { width: 0, height: 0 });

        const wrapper: Box = new Box(wrapperPosition, {
          style: {
            position: parentIsFlowContainer ? "relative" : "absolute",
            border: "none",
            backgroundColor: "transparent",
            padding: "0",
            margin: "0",
            overflow: "visible",
          },
        });

        let currentBranchQueries: BuildQuery[] = [];
        let currentConditionResult: boolean | null = null;

        const evaluateAndBuild = (ctx: any) => {
          const fn = compileExpression(conditionExpr);
          let rawResult = fn(ctx);
          let conditionResult = isUnless ? !rawResult : !!rawResult;

          if (conditionResult === currentConditionResult) {
            // Condition hasn't changed, just update existing queries
            currentBranchQueries.forEach(([el, queries]) => {
              queries.forEach(({ pointer }) => {
                if (typeof pointer === "function") pointer(ctx);
              });
            });
            return false;
          }

          currentConditionResult = conditionResult;

          // Destroy old children
          if (wrapper.config.children) {
            const oldChildren = [...wrapper.config.children];
            oldChildren.forEach((child: UIElement<any>) => {
              child.onDestroy(true);
            });
          }
          currentBranchQueries = [];

          // Build the appropriate branch
          const branch = conditionResult ? thenBranch : elseBranch;
          if (branch) {
            const branchJson = cloneDeep(branch);
            if (branchJson.rect) {
              branchJson.rect = rebaseRectToWrapper(branchJson.rect);
            }
            recursiveBuild({ node: branchJson }, wrapper, contextRef, currentBranchQueries);
          }

          return true;
        };

        // Initial build
        evaluateAndBuild(contextRef.context);

        // Register a query so update() can re-evaluate the condition
        const conditionQuery: Query = {
          query: conditionExpr,
          key: "__$if__",
          parent: "",
          pointer: (_context: any) => {
            return evaluateAndBuild(_context);
          },
          expression: {
            source: conditionExpr,
            deps: extractDeps(conditionExpr),
            evaluate: (ctx: any) => compileExpression(conditionExpr)(ctx),
          },
        };

        buildQueries.push([wrapper, [conditionQuery]]);
        parent.addChild(wrapper);
        return;
      }

      if ("$with" in value) {
        const scopePath = value.$with;
        const content = value.content;

        if (!content) return;

        // Resolve the scoped context
        const scopedCtx = get(contextRef.context, scopePath);
        if (scopedCtx && typeof scopedCtx === "object") {
          const scopedContextRef = { context: { ...scopedCtx, $root: rootContext } };
          const contentJson = cloneDeep(content);
          recursiveBuild({ node: contentJson }, parent, scopedContextRef, buildQueries);
        }
        return;
      }

      if ("$partial" in value) {
        const partialName = value.$partial;
        const partialContextPath = value.context;

        if (!registeredTemplates.has(partialName)) {
          console.warn(`UiMap: $partial "${partialName}" not found in registered templates.`);
          return;
        }

        const templateJson = cloneDeep(registeredTemplates.get(partialName));

        // Determine the context for the partial
        let partialContextRef = contextRef;
        if (partialContextPath) {
          const scopedCtx = get(contextRef.context, partialContextPath);
          if (scopedCtx && typeof scopedCtx === "object") {
            partialContextRef = { context: { ...scopedCtx, $root: rootContext } };
          }
        }

        // Build all elements in the template
        recursiveBuild(templateJson, parent, partialContextRef, buildQueries);
        return;
      }

      if ("$each" in value) {
        const arrayPath = value.$each;
        const contentTemplate = value.content;
        const elseTemplate = value.else;

        if (!contentTemplate) {
          console.warn(`UiMap: Missing 'content' definition for $each block`);
          return;
        }

        if (usingPosspecLayout) {
          let childContexts: any[] = [];
          let childQueries: BuildQuery[][] = [];
          let childRoots: UIElement<any>[][] = [];
          let alternateQueries: BuildQuery[] = [];
          let alternateRoots: UIElement<any>[] = [];
          let currentState: "items" | "empty" | "initial" = "initial";

          const buildParentFor = (roots: UIElement<any>[]) => ({
            addChild: (element: UIElement<any>) => {
              roots.push(element);
              parent.addChild(element);
            },
          });

          const destroyRoots = (roots: UIElement<any>[]) => {
            roots.forEach((element) => element.onDestroy(true));
            roots.length = 0;
          };

          const buildEachChildren = (items: any[]) => {
            if (!items || !Array.isArray(items)) {
              items = [];
            }

            if (items.length === 0) {
              if (currentState !== "empty") {
                childRoots.forEach((roots) => destroyRoots(roots));
                childRoots = [];
                childContexts = [];
                childQueries = [];
                destroyRoots(alternateRoots);
                alternateQueries = [];

                if (elseTemplate) {
                  recursiveBuild({ elseNode: cloneDeep(elseTemplate) }, buildParentFor(alternateRoots), contextRef, alternateQueries);
                }
                currentState = "empty";
              }
              return;
            }

            if (currentState === "empty") {
              destroyRoots(alternateRoots);
              alternateQueries = [];
              childRoots = [];
              childContexts = [];
              childQueries = [];
            }

            if (childContexts.length > items.length) {
              for (let i = items.length; i < childContexts.length; i++) {
                destroyRoots(childRoots[i] ?? []);
              }
              childRoots = childRoots.slice(0, items.length);
              childContexts = childContexts.slice(0, items.length);
              childQueries = childQueries.slice(0, items.length);
            }

            for (let i = 0; i < items.length; i++) {
              const itemContext = { ...contextRef.context, ...cloneDeep(items[i]) };
              itemContext.$context = contextRef.context;
              itemContext.$index = i;
              itemContext.$root = rootContext;

              if (i < childQueries.length && childQueries[i]) {
                if (isEqual(childContexts[i].context, itemContext)) {
                  continue;
                }
                childQueries[i].forEach(([, queries]) => {
                  queries.forEach(({ pointer }) => typeof pointer === "function" && pointer(itemContext));
                });
                childContexts[i].context = itemContext;
              } else {
                childQueries[i] = [];
                childContexts[i] = { context: itemContext };
                childRoots[i] = [];

                const itemJson = applyIdSuffix(cloneDeep(contentTemplate), `-${i}`);
                recursiveBuild({ child: itemJson }, buildParentFor(childRoots[i]), childContexts[i], childQueries[i]);
              }
            }

            currentState = "items";
          };

          const eachQueriables: Query[] = [];

          if (arrayPath.includes("{{") && hasExpression(arrayPath)) {
            const exprQuery = testExpressionQuery("$each", arrayPath, value, "");
            if (exprQuery) eachQueriables.push(exprQuery);
          } else if (arrayPath.includes("$$")) {
            const dollarQuery = testQuery("$each", "$$" + arrayPath, value, "");
            if (dollarQuery) eachQueriables.push(dollarQuery);
          } else {
            eachQueriables.push({
              query: arrayPath,
              key: "$each",
              parent: "",
              pointer: value,
            });
          }

          eachQueriables.forEach((query) => {
            query.pointer = (_context: any) => {
              const items = query.expression ? query.expression.evaluate(_context) : get(_context, query.query);
              buildEachChildren(items || []);
              return false;
            };
          });

          buildQueries.push([null, eachQueriables]);
          buildEachChildren(get(contextRef.context, arrayPath) || []);
          return;
        }

        // Create a wrapper box to hold the each content
        const wrapperPosition = usingPosspecLayout
          ? new Position(0, 0, { width: "auto", height: "auto" })
          : parentIsFlowContainer
            ? new Position(0, 0, { width: "auto", height: "auto" })
            : new Position("center", "center", { width: "full", height: "full" });
        const wrapper: Box = new Box(wrapperPosition, {
          style: {
            position: parentIsFlowContainer ? "relative" : "absolute",
            border: "none",
            backgroundColor: "transparent",
            padding: "0",
            margin: "0",
            overflow: "visible",
            pointerEvents: "none",
          },
        });

        let childContexts: any[] = [];
        let childQueries: BuildQuery[][] = [];
        let currentState: "items" | "empty" | "initial" = "initial";
        let alternateQueries: BuildQuery[] = [];

        const buildEachChildren = (items: any[]) => {
          if (!items || !Array.isArray(items)) {
            items = [];
          }

          if (items.length === 0) {
            // Transition to empty state
            if (currentState !== "empty") {
              // Destroy existing item children
              if (wrapper.config.children) {
                const oldChildren = [...wrapper.config.children];
                oldChildren.forEach((child: UIElement<any>) => {
                  child.onDestroy(true);
                });
              }
              childContexts = [];
              childQueries = [];
              alternateQueries = [];

              // Build else content if provided
              if (elseTemplate) {
                const elseJson = cloneDeep(elseTemplate);
                recursiveBuild({ elseNode: elseJson }, wrapper, contextRef, alternateQueries);
              }
              currentState = "empty";
            }
            return;
          }

          // Transition from empty — destroy alternate content
          if (currentState === "empty") {
            if (wrapper.config.children) {
              const oldChildren = [...wrapper.config.children];
              oldChildren.forEach((child: UIElement<any>) => {
                child.onDestroy(true);
              });
            }
            alternateQueries = [];
            childContexts = [];
            childQueries = [];
          }

          // Truncate excess children
          if (childContexts.length > items.length) {
            // Each item may produce multiple children, so we track by childQueries
            for (let i = items.length; i < childContexts.length; i++) {
              childQueries[i]?.forEach(([element]) => {
                if (element && !element.destroyed) {
                  element.onDestroy(true);
                }
              });
            }
            childContexts = childContexts.slice(0, items.length);
            childQueries = childQueries.slice(0, items.length);
          }

          // Build or update each item
          for (let i = 0; i < items.length; i++) {
            const itemContext = { ...contextRef.context, ...cloneDeep(items[i]) };
            itemContext.$context = contextRef.context;
            itemContext.$index = i;
            itemContext.$root = rootContext;

            if (i < childQueries.length && childQueries[i]) {
              // Update existing item
              if (isEqual(childContexts[i].context, itemContext)) {
                continue;
              }
              childQueries[i].forEach(([element, queries]) => {
                queries.forEach(({ pointer }) => typeof pointer === "function" && pointer(itemContext));
              });
              childContexts[i].context = itemContext;
            } else {
              // Build new item
              childQueries[i] = [];
              childContexts[i] = { context: itemContext };

              const itemJson = cloneDeep(contentTemplate);
              const suffixedItemJson = applyIdSuffix(itemJson, `-${i}`);
              recursiveBuild({ child: suffixedItemJson }, wrapper, childContexts[i], childQueries[i]);
            }
          }

          currentState = "items";
        };

        // Collect queriables from the $each expression to find the array path dependency
        const eachQueriables: Query[] = [];

        // Check if arrayPath uses $$ syntax or {{ }} expressions
        if (arrayPath.includes("{{") && hasExpression(arrayPath)) {
          const exprQuery = testExpressionQuery("$each", arrayPath, value, "");
          if (exprQuery) eachQueriables.push(exprQuery);
        } else if (arrayPath.includes("$$")) {
          const dollarQuery = testQuery("$each", "$$" + arrayPath, value, "");
          if (dollarQuery) eachQueriables.push(dollarQuery);
        } else {
          // Treat as a plain context path
          eachQueriables.push({
            query: arrayPath,
            key: "$each",
            parent: "",
            pointer: value,
          });
        }

        // Set up the pointer to rebuild children on array changes
        eachQueriables.forEach((query) => {
          query.pointer = (_context: any) => {
            const items = query.expression
              ? query.expression.evaluate(_context)
              : get(_context, query.query);
            buildEachChildren(items || []);
            return false;
          };
        });

        const wrapperBuildQuery: BuildQuery = [wrapper, eachQueriables];
        buildQueries.push(wrapperBuildQuery);

        // Initial build
        const initialItems = get(contextRef.context, arrayPath) || [];
        buildEachChildren(initialItems);

        parent.addChild(wrapper);
        return;
      }
    };

    json = cloneDeep(json);
    const res: { [key: string]: UIElement<any> } = {};
    Object.entries(json).forEach(([key, value]: any) => {
      if (!value.type) {
        throw new Error("No nesting");
      }
      let childIndex = 0;
      recursiveBuild(
        { parent: value },
        {
          addChild: (element: UIElement<any>) => {
            if (childIndex === 0) {
              res[key] = element;
            } else {
              res[`${key}.${childIndex}`] = element;
            }
            childIndex++;
          },
        },
        { context },
        lastContext
      );
    });

    if (boxPosition) {
      const box = new Box(boxPosition, boxConfig);
      Object.entries(res).forEach(([key, value]) => {
        box.addChild(value);
      });
      builtRoots = { box };
      runPosspecLayout();
      return { box };
    }

    builtRoots = res;
    runPosspecLayout();
    return res;
  };

  const update = (partialContext: any) => {
    Object.keys(partialContext).forEach((key) => {
      buildContext[key] = cloneDeep(partialContext[key]);
    });

    lastContext.forEach(([element, elementQueries]: BuildQuery) => {
      for (let i = 0; i < elementQueries.length; i++) {
        const pointer = elementQueries[i].pointer;
        if (typeof pointer === "function") {
          pointer(buildContext);
        }
      }
      // const contextValue = get(context, query);
      // console.log(contextValue, query, key, pointer);
      // if (contextValue !== undefined && pointer[key] !== contextValue) {
      //   pointer[key] = contextValue;
      // }
    });
    runPosspecLayout();
    return;
  };

  const context = () => {
    return cloneDeep(buildContext);
  };

  return { build, update, context };
};
