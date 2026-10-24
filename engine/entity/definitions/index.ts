/**
 * Pure entity-definition core: types, inheritance, value mappers, dependency ordering, a
 * non-singleton registry and a compiled spawner. No asset loading, no GameModel, no systems and no
 * global state, so it is safe in workers and lean worlds. EntityFactory wraps it for GameModel.
 */
export type {
  ComponentData,
  DefinitionRandom,
  EntityDefinition,
  EnumResolver,
  FlexibleEntityDefinition,
  ValueContext,
} from "./types";
export { componentOf, definitionsFromModules, hasComponents, inheritDefinition, resolveDefinitions } from "./resolve";
export { enumValue, hasDynamicValues, hexToRgbNumber, isDynamicValue, mapDefinitionString, mapDefinitionValues } from "./values";
export type { DependencyResolver } from "./order";
export { orderComponents, systemDependencies } from "./order";
export type { CompileOptions, CompiledComponent, CompiledEntity, ComponentOverrides, SpawnContext } from "./compile";
export { compileEntityDefinition } from "./compile";
export type { RegistryOptions } from "./registry";
export { EntityDefinitionRegistry } from "./registry";
export { entityTypeOf, yageTypeComponents } from "./yageTypes";
