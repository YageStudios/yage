import { addComponent, addEntity, getComponentByType } from "minecs";
import type { Schema, World } from "minecs";
import type { DependencyResolver } from "./order";
import { orderComponents } from "./order";
import type { ComponentData, EntityDefinition, EnumResolver, ValueContext } from "./types";
import { hasDynamicValues, mapDefinitionValues } from "./values";

export type ComponentOverrides = Record<string, Record<string, unknown> | ((data: Record<string, unknown>) => Record<string, unknown>)>;

export interface SpawnContext extends ValueContext {
  /** Per component type: fields merged over the definition's data (or a function of it). */
  overrides?: ComponentOverrides;
}

export interface CompileOptions {
  enums?: EnumResolver;
  /** Component order by declared system dependencies (see systemDependencies). Default: authored order. */
  dependencies?: DependencyResolver;
  /** Schema lookup by type. Default: minecs getComponentByType. */
  resolveSchema?: (type: string) => typeof Schema | undefined;
  /** Components added for every definition unless it authors them (e.g. yageTypeComponents). */
  implicitComponents?: (definition: EntityDefinition) => ComponentData[];
  /** What to do with a component whose schema is unknown. Default "error". */
  unknownComponents?: "error" | "skip";
  /** Compiles a child definition by name (the registry provides it). */
  compileChild?: (name: string) => CompiledEntity;
}

export interface CompiledComponent {
  type: string;
  schema: typeof Schema;
  /** Whether the data needs a fresh copy and value mapping per spawn. */
  dynamic: boolean;
}

export interface CompiledEntity {
  name: string;
  /** The resolved definition (shared; do not mutate). */
  definition: EntityDefinition;
  /** Components in add order. */
  components: readonly CompiledComponent[];
  /** Adds the definition's components to an existing entity. */
  apply(world: World, eid: number, ctx?: SpawnContext): void;
  /** addEntity, apply, then spawns children (with Child.parent set). Returns the root eid. */
  spawn(world: World, ctx?: SpawnContext): number;
}

const isPlainFlat = (data: Record<string, unknown>) => {
  for (const key in data) {
    const v = data[key];
    if (v !== null && typeof v === "object") return false;
  }
  return true;
};

const deepCopy = (value: any): any => {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value !== null && typeof value === "object") {
    const out: any = {};
    for (const key in value) out[key] = deepCopy(value[key]);
    return out;
  }
  return value;
};

/**
 * Compiles a resolved definition once (implicit components, value mapping of static enum:/rgb:
 * values, schema lookup and dependency order) into a spawner that only copies data and maps
 * rand:/randint:/playercount: values per entity. Built for tight per-NPC loops.
 */
export const compileEntityDefinition = (definition: EntityDefinition, options: CompileOptions = {}): CompiledEntity => {
  const resolveSchema = options.resolveSchema ?? getComponentByType;
  const authored = (definition.components ?? []).slice();
  for (const implicit of options.implicitComponents?.(definition) ?? []) {
    if (!authored.some((c) => c.type === implicit.type)) authored.push(implicit);
  }
  const ordered = options.dependencies ? orderComponents(authored, options.dependencies) : authored;

  type Plan = CompiledComponent & { template: Record<string, unknown>; flat: boolean };
  const plans: Plan[] = [];
  for (const component of ordered) {
    if (component.enabled === false) continue;
    const schema = resolveSchema(component.type);
    if (!schema) {
      if (options.unknownComponents === "skip") continue;
      throw new Error(`yage definitions: "${definition.name}" uses component "${component.type}", which has no registered schema`);
    }
    const raw = deepCopy(component.data ?? component);
    const dynamic = hasDynamicValues(raw);
    // Static special values (enum:, rgb:) resolve now; dynamic ones resolve per spawn.
    const template = dynamic ? raw : mapDefinitionValues(raw, { enums: options.enums });
    plans.push({ type: component.type, schema, dynamic, template, flat: !dynamic && isPlainFlat(template) });
  }

  const children = (definition.children ?? []).map((name) => {
    if (!options.compileChild) throw new Error(`yage definitions: "${definition.name}" has children but no compileChild`);
    return options.compileChild(name);
  });
  let Child: typeof Schema | undefined;
  let Transform: typeof Schema | undefined;
  if (children.length) {
    Child = resolveSchema("Child");
    Transform = resolveSchema("Transform");
    if (!Child) throw new Error(`yage definitions: "${definition.name}" has children, which need a "Child" schema`);
  }

  const apply = (world: World, eid: number, ctx: SpawnContext = {}, parent?: number) => {
    const overrides = ctx.overrides;
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      let data: Record<string, unknown> = plan.flat
        ? plan.template
        : plan.dynamic
        ? mapDefinitionValues(deepCopy(plan.template), { enums: options.enums, ...ctx })
        : deepCopy(plan.template);
      const override = overrides?.[plan.type];
      if (override) data = { ...data, ...(typeof override === "function" ? override(data) : override) };
      if (parent !== undefined && plan.schema === Child) data = { ...data, parent };
      addComponent(world, plan.schema as any, eid, data as any);
    }
    if (parent !== undefined) {
      if (Transform && !plans.some((p) => p.schema === Transform)) addComponent(world, Transform as any, eid, { x: 0, y: 0 } as any);
      if (!plans.some((p) => p.schema === Child)) addComponent(world, Child as any, eid, { parent } as any);
    }
  };

  const spawnWith = (world: World, ctx: SpawnContext | undefined, parent?: number): number => {
    const eid = addEntity(world);
    apply(world, eid, ctx, parent);
    for (const child of children) (child as CompiledInternal).spawnUnder(world, eid, ctx);
    return eid;
  };

  const compiled: CompiledInternal = {
    name: definition.name,
    definition,
    components: plans.map(({ type, schema, dynamic }) => ({ type, schema, dynamic })),
    apply: (world, eid, ctx) => apply(world, eid, ctx),
    spawn: (world, ctx) => spawnWith(world, ctx),
    spawnUnder: (world, parent, ctx) => spawnWith(world, ctx === undefined ? undefined : { ...ctx, overrides: undefined }, parent),
  };
  return compiled;
};

type CompiledInternal = CompiledEntity & {
  spawnUnder(world: World, parent: number, ctx?: SpawnContext): number;
};
