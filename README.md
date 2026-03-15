
# YAGE (Yet Another Game Engine)

YAGE is a fast, data-driven 2D game engine built on top of an Entity Component System (ECS). It focuses on seamless multiplayer capabilities, robust physics, and ease of use through data-driven entity and UI definitions.

## Features

- **Entity Component System (ECS):** Powered by [`minecs`](https://github.com/yagestudios/minecs), providing high-performance, data-oriented game logic.
- **Rendering:** Built with **PixiJS**, supporting Sprites, Spritesheets, Spine animations, and custom graphics.
- **Physics:** Integrated with **Rapier2D** for fast, deterministic 2D physics, rigid bodies, and collision detection.
- **Multiplayer Ready:** Write game logic once and run it in singleplayer, local co-op, or online multiplayer (via **Socket.io** or **PeerJS**). Includes a robust frame-syncing and replay system.
- **Tiled Map Support:** Load maps created in [Tiled](https://www.mapeditor.org/), with full support for both Orthogonal and Isometric perspectives, complete with collision extraction and dynamic Z-sorting.
- **Pathfinding:** Built-in fast 2D pathfinding using `l1-path-finder`.
- **Data-Driven Entities:** Define your entities, components, and assets completely in `JSON5`.
- **Dynamic UI Engine:** A custom UI engine supporting Handlebars (`.hbs`) templates, data-binding, flex-box-like grid layouts, and automatic scaling.
- **Input Management:** Out-of-the-box support for Keyboard, Mouse, Gamepad, and on-screen Touch Controls (joysticks, buttons).

---

## Tech Stack

- **TypeScript** - Core language.
- **Minecs** - Entity Component System.
- **Pixi.js** - WebGL 2D Rendering.
- **Rapier2D** - Physics Engine.
- **PeerJS / Socket.io** - Networking.
- **Vite** - Build tool and dev server.

---

## Quick Start

### Installation

```bash
npm install
```

### Running Examples

YAGE comes with several examples demonstrating its features (Networking, UI, Map loading, etc.).

```bash
npm run examples
```
Navigate to `http://localhost:3000` to see the examples list.

### Basic Game Setup

You can bootstrap a game quickly using the `QuickStart` helper:

```typescript
import "yage/schemas/index";
import "yage/console/preload";
import { QuickStart } from "yage/game/QuickStart";
import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import type { GameModel } from "yage/game/GameModel";

QuickStart({
  gameName: "MyGame",
  roomId: "Room1",
  connection: "SINGLEPLAYER", // Or "SOCKET", "PEER", "COOP", "REPLAY"
  
  onPlayerJoin: (gameModel: GameModel, playerId: string) => {
    // Generate a player entity using the EntityFactory
    const player = EntityFactory.getInstance().generateEntity(gameModel, "player");

    // Setup player input
    const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
    playerInput.keyMap = InputManager.buildKeyMap();
    playerInput.pid = playerId;

    return player;
  },

  preload: async () => {
    // Load custom systems
    await import("./systems");
    
    // Load entity definitions (JSON5)
    const entityDefinitions = (await import("./entities")).default;
    EntityFactory.configureEntityFactory(entityDefinitions);

    // Start loading assets
    await AssetLoader.getInstance().load();
  },
});
```

---

## Architecture

### Entity Factory (JSON5)

Entities are defined in `.json5` files. The `EntityFactory` automatically registers these definitions, injects components, and loads associated assets (sprites, sounds, ui, maps).

```json5
// player.json5
{
  type: "Player",
  name: "PlayerEntity",
  components:[
    "PlayerInput",
    "PlayerMovement",
    {
      type: "PixiSprite",
      imageKey: "hero",
      scale: 0.5
    },
    {
      type: "RigidCircle",
      collisionCategory: "enum:CollisionCategoryEnum.ALLY",
      collisionMask: ["enum:CollisionCategoryEnum.ALL"],
      mass: 100,
    },
    "Transform",
    {
      type: "Locomotion",
      speed: 15,
    },
  ],
  assets:[
    { type: "image", key: "hero", url: "hero.png" }
  ]
}
```

### Multiplayer & Networking

YAGE uses a deterministic lockstep/rollback-inspired approach. Game state is tied to frames, and inputs are synced across the network. 

Supported connection types:
- **`SINGLEPLAYER`**: Local loop, no networking.
- **`PEER`**: WebRTC P2P multiplayer via `PeerJS`.
- **`SOCKET`**: Client-Server multiplayer via `Socket.io` (a reference backend is provided in `server/`).
- **`COOP`**: Local multiplayer using multiple input devices (e.g., keyboard + multiple gamepads).
- **`REPLAY`**: Play back a recorded session perfectly using a serialized frame stack.

### UI System

The UI system allows you to build interfaces using Handlebars (`.hbs`) combined with custom XML-like tags (`<Box>`, `<Text>`, `<Button>`, `<Grid>`, `<Image>`, `<TextInput>`). The UI automatically data-binds to your ECS game state.

```handlebars
<!-- ShopGrid.hbs -->
<Box width="100%" height="100%" y="top" x="left">
  <Grid items="{{ items }}" width="100%" height="100%" gap="5px">
    <Button focusable="true" onclick="selectItem">
      <Image imageKey="{{ data.imageKey }}" />
      <Text>{{ name }}</Text>
    </Button>
  </Grid>
</Box>
```

UI is updated cleanly based on component changes (e.g., mapping UI updates tightly in ECS Systems).

### Map Loading & Pathfinding

YAGE supports `.json` exports from Tiled. Maps can be Orthogonal or Isometric.

- **Collision Generation:** YAGE automatically traces Object layers and Tile boundaries to generate Rapier2D static colliders (Polygons, Rectangles, Ellipses).
- **Pathfinding:** Built-in translation of map grids to `l1-path-finder` for instantaneous A* navigation.
- **Triggers:** Maps support object triggers natively (e.g., `SPAWN`, `CAMERABOUNDARY`, `TELEPORT`, and complex condition-based triggers like `KILLSTATS` and `TIME`).

---

## Directory Structure

```
├── engine/                  # Core Engine Code
│   ├── achievements/        # Local indexedDB-backed achievement system
│   ├── camera/              # Camera systems (Self, Entity follow)
│   ├── connection/          # Network adapters (Peer, Socket, Coop, Replay)
│   ├── console/             # In-game dev console & flags overlay
│   ├── entity/              # EntityFactory and asset loading definitions
│   ├── game/                # Game loop (Ticker), GameModel, Scene management
│   ├── inputs/              # Keyboard, Gamepad, Touch, Mouse, Player Event queues
│   ├── loader/              # Asset loading (Pixi, Spine, Sounds, Tiled, UI)
│   ├── persist/             # IndexedDB wrapper for game saves / state
│   ├── schemas/             # Minecs Component Schema Definitions
│   ├── systems/             # Minecs Game Systems (Physics, Render, Map, Triggers)
│   ├── ui/                  # UI Engine (DOM and Canvas overlays, Templating)
│   └── utils/               # Math, Vectors, Pathfinding, Spatial Hashing, Springs
├── examples/                # Showcase Games & Examples
│   ├── ball/                # Basic singleplayer example
│   ├── map/                 # Tiled Map & Isometric loading example
│   ├── peer/                # PeerJS Multiplayer example
│   ├── socket/              # Socket.io Multiplayer example
│   ├── uimap/               # UI data-binding and layout example
│   └── reball/              # Replay & History debugging example
└── server/                  # Basic Socket.io backend server for multiplayer
```

---

## Controls & Dev Console

Press `/` or `>` in-game to open the **Developer Console**. You can toggle various debug flags:
- `DEBUG`: Show collision bounds, spatial hashes, debug overlays.
- `PHYSICS`: Render Rapier2D physics wireframes via `PhysicsDrawPixiSystem`.
- `PERFORMANCE_LOGS`: Show real-time frame timings per ECS system.
- `RELOAD`: Hot reload the game instance.

---

## License

This project is licensed under the NO-AI Attribution-NonCommercial-ShareAlike 4.0 International License.

*The Covered Software and any modifications made to it may not be used for the purpose of training or improving machine learning algorithms, including but not limited to artificial intelligence, natural language processing, or data mining.*
