import type { CompileOptions, CompiledEntity } from "./compile";
import { compileEntityDefinition } from "./compile";
import { componentOf, hasComponents, resolveDefinitions } from "./resolve";
import type { ComponentData, EntityDefinition, FlexibleEntityDefinition, ValueContext } from "./types";
import { mapDefinitionValues } from "./values";

export type RegistryOptions = Omit<CompileOptions, "compileChild">;

/**
 * A resolved set of entity definitions. Not a singleton: make as many as you like (one per worker,
 * one per test). Lookups are case-insensitive; iteration keeps the input order.
 */
export class EntityDefinitionRegistry {
  readonly definitions: Map<string, EntityDefinition>;
  private readonly json = new Map<string, string>();
  private readonly compiled = new Map<string, CompiledEntity>();

  constructor(definitions: readonly FlexibleEntityDefinition[], readonly options: RegistryOptions = {}) {
    this.definitions = resolveDefinitions(definitions);
    for (const [key, definition] of this.definitions) this.json.set(key, JSON.stringify(definition));
  }

  has(name: string): boolean {
    return this.definitions.has(name.toLowerCase());
  }

  /** Lowercased names in input order. */
  names(): string[] {
    return Array.from(this.definitions.keys());
  }

  /** The shared resolved definition (do not mutate), or undefined. */
  peek(name: string): EntityDefinition | undefined {
    return this.definitions.get(name.toLowerCase());
  }

  /** A deep copy of the resolved definition, with values mapped when `ctx` is given. Throws when unknown. */
  get(name: string, ctx?: ValueContext): EntityDefinition {
    const json = this.json.get(name.toLowerCase());
    if (json === undefined) throw new Error(`yage definitions: unknown entity definition "${name}"`);
    const copy = JSON.parse(json) as EntityDefinition;
    return ctx ? mapDefinitionValues(copy, { enums: this.options.enums, ...ctx }) : copy;
  }

  /** Definitions (shared) that have every one of `types`, in input order. */
  withComponent(...types: string[]): EntityDefinition[] {
    return Array.from(this.definitions.values()).filter((d) => hasComponents(d, types));
  }

  /** The named definition's component of `type` (shared; pass copy=true for a deep copy). */
  component(name: string, type: string, copy = false): ComponentData | undefined {
    const definition = this.peek(name);
    const component = definition && componentOf(definition, type);
    return component && copy ? JSON.parse(JSON.stringify(component)) : component;
  }

  /** Compiles (once, cached) the named definition into a fast spawner. */
  compile(name: string): CompiledEntity {
    const key = name.toLowerCase();
    let compiled = this.compiled.get(key);
    if (!compiled) {
      const definition = this.peek(key);
      if (!definition) throw new Error(`yage definitions: unknown entity definition "${name}"`);
      compiled = compileEntityDefinition(definition, { ...this.options, compileChild: (child) => this.compile(child) });
      this.compiled.set(key, compiled);
    }
    return compiled;
  }
}
