/** One component in a definition: `type` names the schema; values sit in `data` or beside `type`. */
export type ComponentData = {
  type: string;
  [key: string]: any;
};

export interface EntityDefinition {
  name: string;
  type?: string;
  children?: string[];
  components?: ComponentData[];
  inherits?: string[] | string;
}

/** A definition as authored: components may be bare type names, and it may list assets. */
export type FlexibleEntityDefinition<Asset = unknown> = Omit<EntityDefinition, "components"> & {
  components?: (ComponentData | string)[];
  assets?: Asset[];
};

/** The random source the value mappers use (GameModel.rand fits). */
export interface DefinitionRandom {
  number(): number;
  int(min: number, max?: number): number;
}

/** Resolves an enum by name, e.g. "EntityTypeEnum". */
export type EnumResolver = (name: string) => Record<string, unknown> | undefined;

export interface ValueContext {
  /** Needed only when a value uses rand:/randint:/randdzint:. */
  rand?: DefinitionRandom;
  /** Needed only when a value uses enum:. */
  enums?: EnumResolver;
  /** Used by playercount:. Defaults to 0. */
  playerCount?: number;
}
