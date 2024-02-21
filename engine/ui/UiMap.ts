import { Box, BoxConfig } from "@/ui/Box";
import { Position } from "@/ui/Rectangle";
import { UIElement, UIElementConfig } from "@/ui/UIElement";
import { UIConfig, createByType } from "@/ui/UiConfigs";
import { cloneDeep, get, isEqual, merge } from "lodash";

export type UiMap = {
  build: (
    context: any,

    eventHandler: (eventName: string, eventType: string, context: any) => void
  ) => { [key: string]: UIElement<any> };
  update: (context: any) => void;
  context: () => any;
};

type Query = {
  query: string;
  key: string;
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
  context: any,
  eventListener: (eventName: any, eventType: any, eventData: any) => void
) => {
  return events
    ? {
        onClick: () => {
          if (events.click) {
            eventListener(events.click, "click", context);
          }
          if (events.trigger) {
            eventListener(events.trigger, "trigger", context);
          }
          return false;
        },
        onMouseDown: () => {
          if (events.mouseDown) {
            eventListener(events.mouseDown, "mouseDown", context);
          }
          return false;
        },
        onMouseUp: () => {
          if (events.mouseUp) {
            eventListener(events.mouseUp, "mouseUp", context);
          }
          return false;
        },
        onMouseEnter: () => {
          if (events.mouseEnter) {
            eventListener(events.mouseEnter, "mouseEnter", context);
          }
          if (events.hoverFocus) {
            eventListener(events.hoverFocus, "hoverFocus", context);
          }
        },
        onMouseLeave: () => {
          if (events.mouseLeave) {
            eventListener(events.mouseLeave, "mouseLeave", context);
          }
          if (events.hoverBlur) {
            eventListener(events.hoverBlur, "hoverBlur", context);
          }
        },
        onBlur: () => {
          if (events.blur) {
            eventListener(events.blur, "blur", context);
          }
        },
        onFocus: () => {
          if (events.focus) {
            eventListener(events.focus, "focus", context);
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

const testQuery = (key: string, value: string, json: string): Query | undefined => {
  if (value.includes("$$")) {
    const test = /(\$\$[a-zA-Z0-9_.]+)/g;
    let match = test.exec(value);

    if (!match) {
      return;
    }
    if (match[0].length === value.length) {
      return {
        query: value.slice(2),
        key,
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
      key,
      partial,
      pointer: json,
    };
  }
};

const remapTemplateQueries = (json: any, contextMap: any) => {
  Object.entries(json).forEach(([key, value]: [string, any]) => {
    if (typeof value === "string") {
      const query = testQuery(key, value, json);
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
      value.map((v) => remapTemplateQueries(v, contextMap));
    } else if (typeof value === "object") {
      remapTemplateQueries(value, contextMap);
    }
  });
};

export const buildUiMap = (json: any, boxPosition?: Position, boxConfig?: BoxConfig): UiMap => {
  let built: Box | null = null;
  json = cloneDeep(json);

  const lastContext: BuiltContext = [];
  let buildContext: any = null;

  const build = (context: any, eventHandler: (eventName: string, eventType: string, context: any) => void) => {
    if (built) {
      return built;
    }
    buildContext = cloneDeep(context);
    const getQueriables = (json: any): Query[] => {
      return Object.entries(json)
        .map(([key, value]: [string, any]) => {
          if (typeof value === "string") {
            if (value.includes("$$")) {
              return testQuery(key, value, json) || [];
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
            return getQueriables(value);
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
      context: any,
      buildQueries: BuildQuery[]
    ) => {
      Object.entries(json).forEach(([key, value]: [string, any]) => {
        if (!value.type) {
          return recursiveBuild(value, parent, context, buildQueries);
        }
        if (value.type === "template") {
          const config = cloneDeep(value.config);
          const [template, element] = config.template.split(".");
          delete config.template;
          if (registeredTemplates.has(template)) {
            const elements = element ? [element] : [...Object.keys(registeredTemplates.get(template))];

            elements.forEach((element) => {
              let templateJson = cloneDeep(registeredTemplates.get(template)[element]);
              let templateContext = context;
              if (templateJson) {
                if (value.context) {
                  remapTemplateQueries(templateJson, value.context);
                }
                templateJson.config = merge(templateJson.config, config);
                if (value.rect) {
                  templateJson.rect = merge(templateJson.rect, value.rect);
                }
                recursiveBuild({ template: templateJson }, parent, templateContext, buildQueries);
              }
            });
          }
          return;
        }
        if (value.type === "grid") {
          const gridQueriables = getQueriables(value);
          if (gridQueriables.length) {
            gridQueriables.forEach(({ query, key, pointer }: { query: string; key: string; pointer: any }) => {
              const contextValue = get(context, query);
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
            style: {
              border: "none",
              display: "flex",
              flexWrap: "wrap",
              overflow: "auto",
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
              const contextValue = get(_context, query.query);
              // @ts-ignore
              if (contextValue !== undefined && grid.config[query.key] !== contextValue) {
                if (!query.partial) {
                  // @ts-ignore
                  grid.config[query.key] = contextValue;
                } else {
                  // @ts-ignore
                  grid.config[query.key] =
                    query.partial.source.slice(0, query.partial.start) +
                    contextValue +
                    query.partial.source.slice(query.partial.end);
                }
                return true;
              }
              return false;
            };
          });
          let childContexts: any[] = [];
          let childQueries: BuildQuery[][] = [];

          let buildChildren = (items: any) => {
            if (!items) {
              return;
            }
            if (childContexts.length > items.length) {
              const childrenToRemove = grid.config.children.splice(items.length);
              childrenToRemove.forEach((child: UIElement<any>) => {
                child.onDestroy();
              });
              childContexts = childContexts.slice(0, items.length);
              childQueries = childQueries.slice(0, items.length);
            }
            for (let i = 0; i < items.length; i++) {
              const itemContext = { ...context, ...cloneDeep(items[i]) };
              itemContext.$context = context;
              itemContext.$index = i;

              if (!childQueries[i]) {
                childQueries[i] = [];
                childContexts[i] = itemContext;
              } else {
                if (isEqual(childContexts[i], itemContext)) {
                  continue;
                }
                childQueries[i].forEach(([element, query]) => {
                  query.forEach(({ pointer }) => typeof pointer === "function" && pointer(itemContext));
                });
                childContexts[i] = itemContext;
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
                    ...value.element.config.style,
                  },
                },
              };
              recursiveBuild({ child: itemJson }, grid, itemContext, childQueries[i]);
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
            const pointer: Object = query.pointer as Object;
            const contextValue = get(context, query.query);
            if (!query.partial) {
              // @ts-ignore
              pointer[query.key] = contextValue;
            } else {
              // @ts-ignore
              pointer[query.key] =
                query.partial.source.slice(0, query.partial.start) +
                contextValue +
                query.partial.source.slice(query.partial.end);
            }
          });
        }
        const rect = new Position(value.rect.x, value.rect.y, {
          ...value.rect,
        });

        if (value.events) {
          const events = generateEventListener(value.events, context, eventHandler);
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
              const events = generateEventListener(contextValue, context, eventHandler);
              // Object.assign(config.config, events);
              let shouldUpdate = false;
              Object.entries(events).forEach(([key, value]) => {
                element.config[key as keyof UIElementConfig] = value;
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
            // @ts-ignore
            if (contextValue !== undefined && element.config[query.key] !== contextValue) {
              // @ts-ignore
              element.config[query.key] = contextValue;
              return true;
            }
            return false;
          };
        });

        if (queriables.length) {
          buildQueries.push([element, queriables]);
        }

        parent.addChild(element);

        if (value.children) {
          recursiveBuild(value.children, element, context, buildQueries);
        }

        return element;
      });
    };
    json = cloneDeep(json);
    const res: any = {};
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
        context,
        lastContext
      );
    });

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
