import type { SceneTimestep } from "@/game/Scene";
import { Scene } from "@/game/Scene";
import { EntityFactory } from "@/entity/EntityFactory";
import { UIService } from "@/ui/UIService";
import { Text, TextConfig } from "@/ui/Text";
import { Position } from "@/ui/Rectangle";
import AssetLoader from "@/loader/AssetLoader";
import { ConnectionInstance } from "@/connection/ConnectionInstance";
import { Button, ButtonConfig } from "@/ui/Button";
import { TextInputConfig } from "@/ui/TextInput";

// @ts-ignore

import uis from "../ui";
import { UiMap, buildUiMap } from "@/ui/UiMap";
import { InputManager } from "@/inputs/InputManager";
import { KeyboardListener } from "@/inputs/KeyboardListener";
import { GamepadListener, StandardGamepadRegions } from "@/inputs/GamepadListener";

const BigText = (config: Partial<TextConfig>): Partial<TextConfig> => ({
  style: {
    lineHeight: "1.5",
  },
  fontSize: 32,
  ...config,
});

const BigTextInput = (config: Partial<TextInputConfig>): Partial<TextInputConfig> => ({
  style: {
    lineHeight: "1.5",
    borderColor: "white",
  },
  fontSize: 20,
  ...config,
});

const CallToAction = (config: Partial<ButtonConfig>): Partial<ButtonConfig> => ({
  style: {
    borderColor: "pink",
    backgroundColor: "green",
    textTransform: "uppercase",
  },
  fontSize: 32,
  ...config,
});

export class UiSplashScene extends Scene {
  static sceneName = "UiSplash";

  timestep: SceneTimestep = "continuous";
  dt = 4;

  paused = false;
  gameCanvasContext: CanvasRenderingContext2D;
  splashMap: UiMap;
  characterPickerMap: UiMap;

  public initialize = async (args: any[]): Promise<void> => {
    this.splashMap = buildUiMap(uis.lobby__splash);
    this.characterPickerMap = buildUiMap(uis.lobby__characterpicker);

    UIService.configureUi(document.getElementById("uicanvas") as HTMLCanvasElement);
    const inputManager: InputManager = new InputManager();
    new KeyboardListener(inputManager).init(["w", "a", "s", "d", "space", "left", "right", "up", "down"]);
    new GamepadListener(inputManager).init(StandardGamepadRegions);

    UIService.getInstance().enableKeyCapture(inputManager);

    this.ui.background = new Text(
      new Position("center", "center", {
        width: 1920,
        height: 1080,
      }),
      {
        label: "Background",
        style: {
          // backgroundColor: "red",
        },
      }
    );
    this.load();
  };

  load = async () => {
    await import("../components");
    const entityDefinitions = (await import("../entities")).default;
    EntityFactory.configureEntityFactory(entityDefinitions);

    const colors = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "brown", "black", "white"];

    let clickCount = 0;
    this.ui.characterPicker = this.characterPickerMap.build(
      {
        characters: new Array(300).fill(0).map((num, ind) => {
          return {
            name: "brawler",
            index: ind,
            text: "Brawler",
            image: "ShopItem::brawler",
            color: colors[ind % colors.length],
            tags: ["Character::", "Tag::Melee", "Tag::Damage", "Weapon::Fist", "Weapon::Hand", "StartingWeapon::Fist"],
          };
        }),
      },
      (name, type, context) => {
        console.log(name, type, context);
        clickCount++;
        this.characterPickerMap.update({
          characters: new Array(300).fill(0).map((num, ind) => {
            return {
              name: "brawler",
              index: ind,
              text: clickCount % 2 ? " ✓" : "",
              image: "ShopItem::brawler",
              color: colors[ind % colors.length],
              tags: [
                "Character::",
                "Tag::Melee",
                "Tag::Damage",
                "Weapon::Fist",
                "Weapon::Hand",
                "StartingWeapon::Fist",
              ],
            };
          }),
        });

        // if (name === 'selectCharacter') {

        // }
      }
    ).characterPicker;

    const templateMap = buildUiMap(uis.template);
    Object.entries(
      templateMap.build(
        {
          testLabel: "woah nellie",
          popupOpen: false,
        },
        (name, type, context) => {
          console.log(name, type, context);
          if (name === "TemplateClick") {
            console.log("UPDATING");
            templateMap.update({
              color:
                "#" +
                Math.floor(Math.random() * 255 * 255 * 255)
                  .toString(16)
                  .substring(0, 6)
                  .padStart(6, "0"),
            });
          } else if (name === "openPopup") {
            console.log("UPDATING");
            templateMap.update({
              popupOpen: true,
            });
          } else if (name === "closePopup") {
            templateMap.update({
              popupOpen: false,
            });
          }
        }
      )
    ).forEach(([name, element]) => {
      this.ui[name] = element;
    });

    Object.entries(
      this.splashMap.build(
        {
          start: "Start game?",
          child: "Child Test",
        },
        (name, type, context) => {
          console.log(name, type, context);
          if (name === "selectCharacter") {
            console.log("UPDATING");
            const context = this.splashMap.context();
            let reverse = context.shopReverse ?? false;
            const items = [
              {
                label: 'Buy "The Big Sword"',
              },
              {
                label: 'Buy "The Big Shield"',
              },
              {
                label: 'Buy "The Big Boots"',
              },
              {
                label: 'Buy "The Big Helmet"',
              },
            ];
            let nextItems = context.shopItems ?? [];
            if (reverse) {
              nextItems.pop();
            } else {
              nextItems.push(items[nextItems.length]);
            }
            console.log(nextItems);

            if (nextItems.length === items.length || nextItems.length === 0) {
              reverse = !reverse;
            }
            this.splashMap.update({
              shopItems: nextItems,
              shopReverse: reverse,
              child: "Child Test" + nextItems.length,
            });
          }
        }
      )
    ).forEach(([name, element]) => {
      this.ui[name] = element;
    });

    this.ui.deletable = new Button(
      new Position("right", "top", {
        width: 100,
        height: 50,
      }),
      {
        label: "click to delete",
        onClick: () => {
          delete this.ui.deletable;
        },
      }
    );

    this.ui.altAutoFocus = new Button(
      new Position("right", "bottom", {
        width: 100,
        height: 50,
      }),
      {
        autoEmptyFocus: true,
        label: "alt auto focus",
        onClick: () => {},
      }
    );
    // @ts-ignore
    window.clearUi = () => {
      UIService.getInstance().clearUI();
    };

    await AssetLoader.getInstance().load();
    console.log("done");
  };

  run = () => {};
  connection: ConnectionInstance<any>;
  winner: string;

  public destroy() {
    super.destroy();
    console.log("MinMediator: destroy");
  }
}
