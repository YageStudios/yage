import { EntityFactory } from "@/entity/EntityFactory";
import type { GameModel } from "@/game/GameModel";
import { Persist } from "@/persist/persist";
// import { MapIdSchema, MapSpawnSchema } from "../../src/stunningumbrella/components";
import { editor } from "./editor";
type HackingConfig = {
  turnOff?: string[];
  reload?: boolean;
  // eslint-disable-next-line @typescript-eslint/ban-types
  action?: Function;
  label?: string;
  hide?: boolean;
  stateful?: boolean;
};

let gameModel: GameModel;
let testEject: any;

const hackConfig: { [hackName: string]: HackingConfig } = {
  LIST: {},

  _General: { label: "General" }, // PRETTY LISTS

  STICK_SPAWN: {},
  SKIP_DRAW: {},

  GIVE_ITEM: {},
  ACTIVE_ONLY: {},
  PERFORMANCE_LOGS: {},
  HOT: { reload: true }, // hot reloading
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
  WALL: {},
  SPEED: {},
  LOG_GAME_MODEL: {
    action: () => {
      console.log(gameModel);
    },
    stateful: false,
  },
  LIST_SAVES: {
    action: async () => {
      console.log(await Persist.getInstance().listKeys());
      return false;
    },
    stateful: false,
  },
  SAVE_GAME_STATE: {
    action: async (_state: boolean, checkpoint?: string) => {
      await gameModel.saveState(checkpoint ?? "checkpoint");
      return false;
    },
    stateful: false,
  },
  LOAD_GAME_STATE: {
    action: async (_state: boolean, checkpoint?: string) => {
      console.error(checkpoint);
      await gameModel.loadState(checkpoint ?? "checkpoint");
      return false;
    },
    stateful: false,
  },
  PRACTICE_ROOM: {
    action: async () => {
      // const playerId = gameModel.players[0];
      // const mapIdData = gameModel.getTyped(playerId, MapIdSchema);
      // const mapId = mapIdData.mapId;
      // // @ts-ignore
      // mapIdData.mapId = undefined;
      // mapIdData.map = "";
      // const player = gameModel.ejectEntity(gameModel.players[0]);
      // console.log(player);
      // // await gameModel.saveState("practice");
      // gameModel.clearState();
      // gameModel.coreEntity = EntityFactory.getInstance().generateEntity(gameModel, "core");

      // const injectedPlayer = gameModel.injectEntity(player);

      // gameModel.setComponent(injectedPlayer, MapSpawnSchema, {
      //   location: "Spawn Point",
      //   map: "practiceroom",
      // });

      return false;
    },
    stateful: false,
  },
  EJECT: {
    action: () => {
      testEject = gameModel.ejectEntity(gameModel.players[0]);
      console.log(testEject);
      setTimeout(() => {
        gameModel.injectEntity(testEject);
      }, 500);
      return false;
    },
    stateful: false,
  },
  EDITOR: { reload: true },
  EDIT: {
    action: (_active: boolean, id: number) => {
      console.log("Editing", id);
      if (hacks.EDITOR) {
        editor(id, gameModel);
      }
      return false;
    },
  },
  RELOAD: {
    action: () => {
      window.location.reload();
    },
    stateful: false,
    hide: true,
  },
  GAME_STATE_OVERLAY: { reload: true },
  SKIP_MENU: {},

  _Enemies: { label: "Enemies" }, // PRETTY LISTS

  NO_ENEMIES: { turnOff: ["DUMMY"], reload: true },
  DUMMY: { turnOff: ["NO_ENEMIES"], reload: true },

  _Levels: { label: "Levels" }, // PRETTY LISTS

  LEVEL_1: { turnOff: ["TEST_ROOM", "BOSS_ROOM"], reload: true },
  BOSS_ROOM: { turnOff: ["TEST_ROOM", "LEVEL_1"], reload: true },
  TEST_ROOM: { turnOff: ["LEVEL_1", "BOSS_ROOM"], reload: true },
  FLOOR_RENDERER: { reload: true, turnOff: ["MULTI", "PHYSICS"] },
  MULTI: { reload: true, turnOff: ["FLOOR_RENDERER", "PHYSICS"] },
  PHYSICS: { reload: true, turnOff: ["MULTI", "FLOOR_RENDERER"] },

  DEMO: { reload: true },
  HARD_MODE: { reload: true },
  INVINCIBLE: {},

  _Classes: { label: "Classes" }, // PRETTY LISTS

  SWORD: { turnOff: ["BOW", "WAND", "GUN", "SKULLS"], reload: true }, // single player sword boy
  BOW: { turnOff: ["SWORD", "WAND", "GUN", "SKULLS"], reload: true },
  WAND: { turnOff: ["BOW", "SWORD", "GUN", "SKULLS"], reload: true },
  GUN: { turnOff: ["BOW", "WAND", "SWORD", "SKULLS"], reload: true },
  SKULLS: { turnOff: ["BOW", "WAND", "SWORD", "GUN"], reload: true },
};

export const setGameModel = (model: GameModel) => {
  gameModel = model;
};

export const hacks: { [hackName: string]: boolean } = Object.entries(hackConfig).reduce(
  (acc: { [hackName: string]: boolean }, [hackName, hackValue]) => {
    if (!hackValue.label) {
      acc[hackName] = false;
    }
    return acc;
  },
  {}
);
console.log("RUNNING HACKS");
Object.entries(hacks).forEach(([hackName]) => {
  if (typeof window === "undefined") {
    return;
  }
  const local = window.localStorage.getItem(hackName);
  if (local !== null) {
    hacks[hackName] = local === "true";
    if (hackConfig[hackName].action && hackConfig[hackName].stateful !== false) {
      hackConfig[hackName].action?.(hacks[hackName]);
    }
  }
});

export const toggleHack = async (consoleText: string, value?: boolean, ...args2: any[]) => {
  const [hack, ...args] = consoleText.split(" ");
  console.log(hack, args, args2);
  if (hacks[hack] !== undefined) {
    hacks[hack] = value === undefined ? !hacks[hack] : value;
    window.localStorage.setItem(hack, hacks[hack].toString());
    const config = hackConfig[hack] as HackingConfig;
    if (config.action) {
      const result = await config.action(value ?? hacks[hack], ...args, ...args2);
      if (result !== undefined && hacks[hack] !== result) {
        hacks[hack] = result;
        window.localStorage.setItem(hack, hacks[hack].toString());
      }
    }
    renderList();
  }
};

let list: any;
const renderList = () => {
  list.innerHTML = "";
  let pendingLabel: any = false;
  Object.keys(hackConfig).forEach((hackName) => {
    if (
      (hackName === "LIST" ||
        (hacks.ACTIVE_ONLY && (!hacks[hackName] || hackName === "ACTIVE_ONLY")) ||
        !!hackConfig[hackName].hide) &&
      !hackConfig[hackName].label
    ) {
      return;
    }
    const li = document.createElement("li");
    if (!hackConfig[hackName].label) {
      li.innerHTML = `${hackName}: ${hacks[hackName]}`;
      if (pendingLabel) {
        list.appendChild(pendingLabel);
      }
      pendingLabel = false;
      list.appendChild(li);
    } else if (pendingLabel) {
      pendingLabel.innerHTML = "<br/>" + hackConfig[hackName].label;
    } else {
      li.innerHTML = "<br/>" + hackConfig[hackName].label;
      pendingLabel = li;
    }
  });
};

const MAX_HISTORY = 10;

export const DevConsole = () => {
  if (!list) {
    list = document.createElement("ul");
    list.style.display = "none";
    list.id = "hacks";
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

  let matchList: string[] = [];
  let historicMatchList: string[] = localStorage.getItem("matchList")
    ? JSON.parse(localStorage.getItem("matchList") || "[]")
    : [];
  let matchIndex = -1;

  renderList();
  if (hacks.LIST) {
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
              matchList = Object.keys(hacks).filter((hackName) => {
                return hackName.toLowerCase().startsWith(consoleText.toLowerCase().substring(2));
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
          const hackName = consoleText.split(" ")[0];
          const config = hackConfig[hackName] as HackingConfig;

          if (config && !config.label) {
            addToHistory(consoleText);

            toggleHack(consoleText);

            config?.turnOff?.forEach((hack: string) => {
              toggleHack(hack, false);
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
      if (hacks.LIST) {
        list.style.display = "block";
      } else {
        list.style.display = "none";
      }
    },
    { capture: true }
  );
};
