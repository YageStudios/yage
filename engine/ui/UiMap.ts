import type { BoxConfig } from "yage/ui/Box";
import { Box } from "yage/ui/Box";
import { Position } from "yage/ui/Rectangle";
import type { UIElement, UIElementConfig } from "yage/ui/UIElement";
import type { UIConfig } from "yage/ui/UiConfigs";
import { createByType } from "yage/ui/UiConfigs";
import { cloneDeep, get, isEqual, merge } from "lodash";

export type UiMap = {
  build: (
    context: any,

    eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any) => void
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
  return "$if" in value || "$unless" in value || "$with" in value || "$partial" in value || "$each" in value;
};

const generateEventListener = (
  events: any,
  contextRef: any,
  eventListener: (playerIndex: number, eventName: any, eventType: any, eventData: any) => void
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

export const buildUiMap = (json: any, boxPosition?: Position, boxConfig?: Partial<BoxConfig>): UiMap => {
  json = cloneDeep(json);

  const lastContext: BuiltContext = [];
  let buildContext: any = null;
  let rootContext: any = null;

  const build = (
    context: any,
    eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any) => void
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
                ...cloneDeep(value.element),
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
      eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any) => void
    ) => {
      if ("$if" in value || "$unless" in value) {
        const conditionExpr = value.$if || value.$unless;
        const isUnless = "$unless" in value;
        const thenBranch = value.then;
        const elseBranch = value.else;

        // Create a wrapper box to hold the conditional content
        const wrapperPosition = thenBranch?.rect
          ? new Position(thenBranch.rect.x ?? 0, thenBranch.rect.y ?? 0, {
              width: thenBranch.rect.width ?? 0,
              height: thenBranch.rect.height ?? 0,
              ...thenBranch.rect,
            })
          : new Position(0, 0, { width: 0, height: 0 });

        const wrapper = new Box(wrapperPosition, {
          style: {
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

        // Create a wrapper box to hold the each content
        const wrapperPosition = new Position(0, 0, { width: 0, height: 0 });
        const wrapper = new Box(wrapperPosition, {
          style: {
            display: "contents",
            border: "none",
            backgroundColor: "transparent",
            padding: "0",
            margin: "0",
            overflow: "visible",
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
            const excessCount = childContexts.length - items.length;
            // Count total children elements to remove from the end
            const allChildren = wrapper.config.children || [];
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
              recursiveBuild({ child: itemJson }, wrapper, childContexts[i], childQueries[i]);
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
      return { box };
    }

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
    return;
  };

  const context = () => {
    return cloneDeep(buildContext);
  };

  return { build, update, context };
};
