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
};

type BuildQuery = [UIElement<any> | null, Query[]];

type BuiltContext = BuildQuery[];

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

export const buildUiMap = (json: any, boxPosition?: Position, boxConfig?: Partial<BoxConfig>): UiMap => {
  json = cloneDeep(json);

  const lastContext: BuiltContext = [];
  let buildContext: any = null;

  const build = (
    context: any,
    eventHandler: (playerIndex: number, eventName: string, eventType: string, context: any) => void
  ) => {
    buildContext = cloneDeep(context);
    const getQueriables = (json: any, parent = ""): Query[] => {
      return Object.entries(json)
        .map(([key, value]: [string, any]) => {
          if (typeof value === "string") {
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
            gridQueriables.forEach(({ query, key, pointer }: { query: string; key: string; pointer: any }) => {
              const contextValue = get(contextRef.context, query);
              if (key === "items") {
                pointer[key] = contextValue;
                return;
              }
              if (contextValue !== undefined) {
                pointer[key] = contextValue;
              }
            });
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
                const items = get(_context, query.query);
                buildChildren(items);
                return false;
              };
              return;
            }

            query.pointer = (_context) => {
              let contextValue = get(_context, query.query);
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

        const queriables = getQueriables(value);
        if (queriables.length) {
          queriables.forEach((query) => {
            // eslint-disable-next-line @typescript-eslint/ban-types
            const pointer: Object = query.pointer as Object;
            let contextValue = get(contextRef.context, query.query);
            if (query.partial) {
              contextValue =
                query.partial.source.slice(0, query.partial.start) +
                contextValue +
                query.partial.source.slice(query.partial.end);
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
