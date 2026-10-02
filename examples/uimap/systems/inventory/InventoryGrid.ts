import { Component, DrawSystemImpl, Schema, System } from "minecs";
import type { ReadOnlyGameModel } from "yage/game/GameModel";
import { Button, Grid, Panel, Text, UIFinal, signal, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyPressed } from "yage/utils/keys";
import { MappedKeys } from "yage/inputs/InputManager";
import { canPresentUI } from "../../../shared/uiFinal";

// Local-player count this HUD can render panels for.
const MAX_LOCAL_PLAYERS = 4;
const INVENTORY_SLOTS = 25;
const INVENTORY_COLUMNS = 5;

@Component()
class InventoryGrid extends Schema {}

// The TAB toggle lives on the system (presentation-side, like the legacy HUD);
// the panel itself mounts through a UIFinal runtime and unmounts when closed.
@System(InventoryGrid)
export class InventoryGridDrawSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = 1;
  private ui?: UIFinal;
  /** Per-local-player open state; index aligns with gameModel.localNetIds. */
  private open = signal<readonly boolean[]>(Array.from({ length: MAX_LOCAL_PLAYERS }, () => false));

  constructor(query: QueryInstance) {
    super(query);
  }

  init = () => {
    // Headless runs (unit tests) have no real DOM; the panel is presentation-only.
    if (!canPresentUI() || this.ui) return;
    this.ui = new UIFinal().mount(this.panels());
  };

  private panels(): Child {
    return [0, 1, 2, 3].map(player =>
      when(() => this.open.get()[player] === true, () => this.panel(player)));
  }

  // Slot content is fixed ("Empty"), so the panel descriptor is static; only
  // the open state above is reactive.
  private panel(player: number): Child {
    const slots = Array.from({ length: INVENTORY_SLOTS }, (_, slot) =>
      Button({
        id: `inventory-${player}-${slot}`,
        style: { width: 150, height: 150, fontSize: 18 },
      }, Text("Empty")));
    return Panel({
      id: `inventory-${player}`,
      label: `Player ${player + 1} inventory`,
      style: {
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        background: "rgba(0,0,0,0.35)",
      },
    },
      Grid({
        style: {
          gridTemplateColumns: `repeat(${INVENTORY_COLUMNS}, 150px)`, gap: 5, padding: 5,
        },
      }, slots));
  }

  run = (gameModel: ReadOnlyGameModel, runEntity: number) => {
    const selfId = gameModel.getTypedUnsafe(PlayerInput, runEntity)?.pid;
    if (selfId !== gameModel.localNetIds[0]) {
      return;
    }

    const players = gameModel.getEntityByDescription("Player") ?? [];
    const nextOpen = [...this.open.peek()];

    for (const entity of players) {
      const selfId = gameModel.getTypedUnsafe(PlayerInput, entity)?.pid;
      const localNetIndex = gameModel.localNetIds.indexOf(selfId);
      if (localNetIndex === -1) {
        continue;
      }
      const netData = gameModel.getTypedUnsafe(PlayerInput, entity);

      if (keyPressed([MappedKeys.TAB], netData.keyMap, netData.prevKeyMap)) {
        nextOpen[localNetIndex] = !nextOpen[localNetIndex];
      }
    }

    this.open.set(nextOpen);
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}
