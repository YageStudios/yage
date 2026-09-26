/** Browser entrypoint. Build tooling is separately exported from `yage/vite`. */
import "./schemas";
import "./style.css";

export { QuickStart, type QuickStartOptions } from "./game/QuickStart";
export { GameInstance, type GameInstanceOptions } from "./game/GameInstance";
export { GameModel, type ReadOnlyGameModel, type GameModelState } from "./game/GameModel";
export { EntityFactory, type EntityDefinition, type FlexibleEntityDefinition } from "./entity/EntityFactory";
export { default as AssetLoader } from "./loader/AssetLoader";
export { InputManager, InputEventType, MappedKeys } from "./inputs/InputManager";
export { ComponentCategory } from "./constants/enums";

/** Fine-grained retained UI; authoring primitives are exported from `yage/ui/final`. */
export { UIFinal, type UIFinalOptions } from "./ui/final/runtime";
