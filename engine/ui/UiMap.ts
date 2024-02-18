import { Box, BoxConfig } from "@/ui/Box";
import { Position } from "@/ui/Rectangle";
import { UIElement } from "@/ui/UIElement";
import { UIConfig, createByType } from "@/ui/UiConfigs";
import { cloneDeep, get, isEqual, merge } from "lodash";

export type UiMap = {
  build: (
    context: any,

    eventHandler: (eventName: string, eventType: string, context: any) => void
  ) => Box;
  update: (context: any) => void;
  context: () => any;
};

type Query = {
  query: string;
  key: string;
  pointer: (nextValue: any) => void;
};

type BuiltContext = Query[][];

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

export const buildUiMap = (json: any, boxPosition?: Position, boxConfig?: BoxConfig): UiMap => {
  let built: Box | null = null;

  const lastContext: BuiltContext = [];
  let buildContext: any = null;

  const build = (context: any, eventHandler: (eventName: string, eventType: string, context: any) => void) => {
    if (built) {
      return built;
    }
    buildContext = cloneDeep(context);
    const pos = boxPosition ?? new Position("full", "full");
    const box = new Box(
      pos,
      boxConfig ?? {
        style: {
          border: "none",
        },
      }
    );
    const getQueriables = (json: any): Query[] => {
      return Object.entries(json)
        .map(([key, value]: [string, any]) => {
          if (typeof value === "string") {
            if (value.startsWith("$$")) {
              return {
                query: value.slice(2),
                key,
                pointer: json,
              };
            }
          } else if (Array.isArray(value)) {
            if (key === "children") {
              return [];
            }
            return value.map((v) => getQueriables(v)).flat();
          } else if (typeof value === "object") {
            return getQueriables(value);
          }
          return [];
        })
        .flat();
    };
    const recursiveBuild = (json: any, parent: Box, context: any, lastContext: Query[][]) => {
      Object.entries(json).forEach(([key, value]: [string, any]) => {
        if (!value.type) {
          return recursiveBuild(value, parent, context, lastContext);
        }

        if (value.type === "grid") {
          const gridPosition = new Position(value.rect.x, value.rect.y, {
            ...value.rect,
          });
          const gridConfig: BoxConfig = {
            style: {
              border: "none",
              display: "grid",
              gap: value.config.gap,
              overflow: "auto",
            },
          };
          if (value.config.rows.startsWith("auto")) {
            gridConfig.style.gridAutoRows = value.config.rows.replace("auto", "");
          } else {
            gridConfig.style.gridTemplateRows = value.config.rows;
          }
          if (value.config.columns.startsWith("auto")) {
            gridConfig.style.gridAutoColumns = value.config.columns.replace("auto", "");
          } else {
            gridConfig.style.gridTemplateColumns = value.config.columns;
          }
          const grid = new Box(gridPosition, gridConfig);
          let childContexts: any[] = [];
          let childQueries: Query[][][] = [];

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
              const itemContext = items[i];
              itemContext.$context = context;
              itemContext.$index = i;

              if (!childQueries[i]) {
                childQueries[i] = [];
                childContexts[i] = itemContext;
              } else {
                if (isEqual(childContexts[i], itemContext)) {
                  continue;
                }
                childQueries[i].forEach((query) => {
                  query.forEach((q) => {
                    q.pointer(itemContext);
                  });
                });
                continue;
              }

              const itemJson = {
                ...value.element,
                rect: {
                  x: 0,
                  y: 0,
                  width: "100%",
                  height: "100%",
                },
                config: {
                  ...value.element.config,
                  style: {
                    ...value.element.config.style,
                    position: "relative",
                  },
                },
              };
              recursiveBuild({ child: itemJson }, grid, itemContext, childQueries[i]);
            }
          };

          const queriables: Query[] = [];
          if (typeof value.items === "string") {
            const query = value.items;
            value.items = get(context, value.items);
            queriables.push({
              query: query.substring(2),
              key: "items",
              pointer: (_context) => {
                const items = get(_context, query.substring(2));
                buildChildren(items);
              },
            });
          }

          lastContext.push(queriables);

          buildChildren(value.items);

          parent.addChild(grid);

          return;
        }

        value.config = value.config || {};

        const queriables = getQueriables(value);
        if (queriables.length) {
          queriables.forEach(({ query, key, pointer }: { query: string; key: string; pointer: any }) => {
            const contextValue = get(context, query);
            if (contextValue !== undefined) {
              pointer[key] = contextValue;
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

        const config: UIConfig = {
          type: value.type,
          rect,
          config: value.config,
        };

        const element = createByType(config);

        queriables.forEach((query) => {
          query.pointer = (_context) => {
            const contextValue = get(_context, query.query);

            if (query.key === "events") {
              const events = generateEventListener(contextValue, context, eventHandler);
              // Object.assign(config.config, events);
              Object.entries(events).forEach(([key, value]) => {
                // @ts-ignore
                element.config[key] = value;
              });

              return;
            }
            // @ts-ignore
            if (contextValue !== undefined && element.config[query.key] !== contextValue) {
              // @ts-ignore
              element.config[query.key] = contextValue;
            }
          };
        });

        if (queriables.length) {
          lastContext.push(queriables);
        }

        parent.addChild(element);

        return element;
      });
    };
    recursiveBuild(json, box, context, lastContext);

    return box;
  };

  const update = (partialContext: any) => {
    Object.keys(partialContext).forEach((key) => {
      buildContext[key] = cloneDeep(partialContext[key]);
    });

    lastContext.forEach((queries) => {
      queries.forEach(({ pointer }: any) => {
        pointer(buildContext);
        // const contextValue = get(context, query);
        // console.log(contextValue, query, key, pointer);
        // if (contextValue !== undefined && pointer[key] !== contextValue) {
        //   pointer[key] = contextValue;
        // }
      });
    });
    return;
  };

  const context = () => {
    return cloneDeep(buildContext);
  };

  return { build, update, context };
};
