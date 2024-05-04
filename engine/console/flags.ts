import type { GameModel } from "yage/game/GameModel";
import { windowSessionStorage } from "yage/utils/windowSessionStorage";
type FlagingConfig = {
  turnOff?: string[];
  reload?: boolean;
  // eslint-disable-next-line @typescript-eslint/ban-types
  action?: Function;
  label?: string;
  hide?: boolean;
  stateful?: boolean;
  windowScope?: boolean;
};

let gameModel: GameModel;
let testEject: any;

const flagConfig: { [flagName: string]: FlagingConfig } = {
  LIST: {},

  _General: { label: "General" }, // PRETTY LISTS

  ACTIVE_ONLY: {},
  PERFORMANCE_LOGS: {},
  DEBUG: {
    action: (active: boolean) => {
      console.log(active);
      if (active) {
        document.body.classList.add("debug");
      } else {
        document.body.classList.remove("debug");
      }
    },
  },
  LOG_GAME_MODEL: {
    action: () => {
      console.log(gameModel);
    },
    stateful: false,
  },
  RELOAD: {
    action: () => {
      window.location.reload();
    },
    stateful: false,
    hide: true,
  },
  GAME_STATE_OVERLAY: { reload: true },

  FPS_30: {},

  PHYSICS: {},

  INVINCIBLE: {
    windowScope: true,
  },
};

export const setGameModel = (model: GameModel) => {
  gameModel = model;
};

export const addFlags = (additionalFlags: { [flagName: string]: FlagingConfig }) => {
  Object.assign(flagConfig, additionalFlags);
  Object.entries(additionalFlags).forEach(([flagName, localConfig]) => {
    let local: string | null = null;
    if (localConfig.windowScope) {
      local = windowSessionStorage.getItem(flagName);
    } else {
      local = window.localStorage.getItem(flagName);
    }

    if (flags[flagName] === undefined) {
      flags[flagName] = false;
    }
    if (localConfig.label) {
      flags[flagName] = false;
    }
    if (local !== null) {
      flags[flagName] = local === "true";
      if (flagConfig[flagName].action && flagConfig[flagName].stateful !== false) {
        flagConfig[flagName].action?.(flags[flagName]);
      }
    }
  });
};

export const flags: { [flagName: string]: boolean } = Object.entries(flagConfig).reduce(
  (acc: { [flagName: string]: boolean }, [flagName, flagValue]) => {
    if (!flagValue.label) {
      acc[flagName] = false;
    }
    return acc;
  },
  {}
);
Object.entries(flags).forEach(([flagName]) => {
  if (typeof window === "undefined") {
    return;
  }
  let local: string | null = null;
  if (flagConfig[flagName].windowScope) {
    local = windowSessionStorage.getItem(flagName);
  } else {
    local = window.localStorage.getItem(flagName);
  }
  if (local !== null) {
    flags[flagName] = local === "true";
    if (flagConfig[flagName].action && flagConfig[flagName].stateful !== false) {
      flagConfig[flagName].action?.(flags[flagName]);
    }
  }
});

export const toggleFlag = async (consoleText: string, value?: boolean, ...args2: any[]) => {
  const [flag, ...args] = consoleText.split(" ");
  console.log(flag, args, args2);
  if (flags[flag] !== undefined) {
    flags[flag] = value === undefined ? !flags[flag] : value;
    if (flagConfig[flag].windowScope) {
      windowSessionStorage.setItem(flag, flags[flag].toString());
    } else {
      window.localStorage.setItem(flag, flags[flag].toString());
    }
    const config = flagConfig[flag] as FlagingConfig;
    if (config.action) {
      const result = await config.action(value ?? flags[flag], ...args, ...args2);
      if (result !== undefined && flags[flag] !== result) {
        flags[flag] = result;
        if (flagConfig[flag].windowScope) {
          windowSessionStorage.setItem(flag, flags[flag].toString());
        } else {
          window.localStorage.setItem(flag, flags[flag].toString());
        }
      }
    }
    renderList();
  }
};

let list: any;
const renderList = () => {
  list.innerHTML = "";
  let pendingLabel: any = false;
  Object.keys(flagConfig).forEach((flagName) => {
    if (
      (flagName === "LIST" ||
        (flags.ACTIVE_ONLY && (!flags[flagName] || flagName === "ACTIVE_ONLY")) ||
        !!flagConfig[flagName].hide) &&
      !flagConfig[flagName].label
    ) {
      return;
    }
    const li = document.createElement("li");
    if (!flagConfig[flagName].label) {
      li.innerHTML = `${flagName}: ${flags[flagName]}`;
      if (pendingLabel) {
        list.appendChild(pendingLabel);
      }
      pendingLabel = false;
      list.appendChild(li);
    } else if (pendingLabel) {
      pendingLabel.innerHTML = "<br/>" + flagConfig[flagName].label;
    } else {
      li.innerHTML = "<br/>" + flagConfig[flagName].label;
      pendingLabel = li;
    }
  });
};

const MAX_HISTORY = 10;

export const DevConsole = () => {
  if (!list) {
    list = document.createElement("ul");
    list.style.display = "none";
    list.style.pointerEvents = "none";
    list.id = "flags";
    list.style.zIndex = "1000000";
  }

  let consoleOpen = false;

  let consoleText = "";
  const consoleBar = document.createElement("div");
  consoleBar.style.display = "none";
  consoleBar.style.zIndex = "100";
  consoleBar.style.position = "fixed";
  consoleBar.style.top = "0";
  consoleBar.style.left = "0";
  consoleBar.style.width = "100%";
  consoleBar.style.height = "30px";
  consoleBar.style.backgroundColor = "#000";
  consoleBar.style.color = "#fff";
  consoleBar.style.paddingTop = "10px";

  list.style.listStyleType = "none";
  list.style.position = "fixed";
  list.style.top = "30px";
  list.style.left = "0";
  list.style.color = "#fff";
  list.style.fontFamily = "monospace";
  list.style.fontSize = "19px";
  list.style.fontWeight = "bold";

  let matchList: string[] = [];
  let historicMatchList: string[] = localStorage.getItem("matchList")
    ? JSON.parse(localStorage.getItem("matchList") || "[]")
    : [];
  let matchIndex = -1;

  renderList();
  if (flags.LIST) {
    list.style.display = "block";
  }

  document.body.appendChild(consoleBar);
  document.body.appendChild(list);

  const addToHistory = (text: string) => {
    if (text.length > 0) {
      historicMatchList = historicMatchList.filter((item) => item !== text);
      historicMatchList.push(text);
      if (historicMatchList.length > MAX_HISTORY) {
        historicMatchList.shift();
      }
      localStorage.setItem("matchList", JSON.stringify(historicMatchList));
    }
  };

  document.addEventListener(
    "keydown",
    (e) => {
      let key = e.key;
      if ((key === ">" || key === "/") && !consoleOpen) {
        consoleOpen = true;
        consoleBar.style.display = "block";
        consoleText = "> ";
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (key === "Escape" && consoleOpen) {
        consoleOpen = false;
        consoleBar.style.display = "none";
        matchList = [];
        matchIndex = -1;
      } else if (consoleOpen) {
        if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") {
          // ignore shift ctrl alt etc
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();

        if (key === "Tab") {
          if (matchList.length === 0) {
            if (consoleText === "> ") {
              matchList = [...historicMatchList].reverse();
            } else {
              matchList = Object.keys(flags).filter((flagName) => {
                return flagName.toLowerCase().startsWith(consoleText.toLowerCase().substring(2));
              });
            }
            matchIndex = 0;
          } else {
            if (e.shiftKey) {
              matchIndex = matchIndex - 1;
              if (matchIndex < 0) {
                matchIndex = matchList.length - 1;
              }
            } else {
              matchIndex = (matchIndex + 1) % matchList.length;
            }
          }
          if (matchList[matchIndex]) {
            consoleText = "> " + matchList[matchIndex];
          }
          key = "";
        } else {
          matchList = [];
          matchIndex = -1;
        }

        if (key === "Enter" || key === "/") {
          consoleText = consoleText.substring(2).toUpperCase();
          const flagName = consoleText.split(" ")[0];
          const config = flagConfig[flagName] as FlagingConfig;

          if (config && !config.label) {
            addToHistory(consoleText);

            toggleFlag(consoleText);

            config?.turnOff?.forEach((flag: string) => {
              toggleFlag(flag, false);
            });
            if (config?.reload) {
              window.location.reload();
            }
          }

          renderList();
          consoleOpen = false;
          consoleBar.style.display = "none";
        } else if (key === "Backspace") {
          if (consoleText.length > 2) {
            consoleText = consoleText.substring(0, consoleText.length - 1);
          }
        } else if (key === "-") {
          consoleText += "_";
        } else if (key.length > 1) {
          console.log("Unsupported key", key);
        } else {
          consoleText += key;
        }
        if (!consoleText.startsWith("> ")) {
          consoleText = "> " + consoleText.trim();
        }
      }
      if (consoleOpen) {
        consoleBar.innerHTML = consoleText.toUpperCase();
      }
      if (flags.LIST) {
        list.style.display = "block";
      } else {
        list.style.display = "none";
      }
    },
    { capture: true }
  );
};
