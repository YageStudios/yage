import { entityExists, getComponentByType, hasComponent } from "minecs";
import type { World } from "minecs";
import lodash from "lodash";
import type { EntityFactory } from "./EntityFactory";

const { cloneDeep, isEqual } = lodash;

const templates = new WeakMap<World, Map<number, string>>();

export function forgetEntityTemplate(world: World, entity: number): void {
  templates.get(world)?.delete(entity);
}

export function trackEntityTemplate(
  world: World,
  entity: number,
  template: string
): void {
  let entities = templates.get(world);
  if (!entities) {
    entities = new Map();
    templates.set(world, entities);
  }
  entities.set(entity, template.toLowerCase());
}

/** Compare resolved defaults, including schema defaults omitted by the template. */
function defaults(
  factory: EntityFactory,
  template: string
): Map<string, Record<string, unknown>> {
  const definition = factory.entityDefinitionMap.get(template);
  const result = new Map<string, Record<string, unknown>>();
  if (!definition) return result;
  for (const component of factory.generateComponents(cloneDeep(definition))
    .components) {
    if (component.enabled === false) continue;
    const schema = getComponentByType(component.type);
    if (!schema) continue;
    const authored = component.data ?? component;
    const data = Object.fromEntries(
      Object.keys(schema.schema.properties)
        .filter((key) => key in authored)
        .map((key) => [key, cloneDeep(authored[key])])
    );
    // Expressions requiring a world are not literal defaults and cannot be compared safely.
    if (!schema.validate(data)) continue;
    result.set(component.type, data);
  }
  return result;
}

export function applyEntityDefaults(
  world: World,
  previous: EntityFactory,
  next: EntityFactory
): void {
  const entities = templates.get(world);
  if (!entities) return;
  const changes = new Map<
    string,
    [ReturnType<typeof defaults>, ReturnType<typeof defaults>]
  >();
  for (const [entity, template] of entities) {
    if (!entityExists(world, entity)) {
      entities.delete(entity);
      continue;
    }
    let values = changes.get(template);
    if (!values) {
      values = [defaults(previous, template), defaults(next, template)];
      changes.set(template, values);
    }
    const [oldDefaults, newDefaults] = values;
    for (const [type, updated] of newDefaults) {
      const before = oldDefaults.get(type);
      const schema = getComponentByType(type);
      if (!before || !schema || !hasComponent(world, schema, entity)) continue;
      const component = world(schema, entity) as unknown as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(updated)) {
        if (!(key in before) || isEqual(before[key], value)) continue;
        let expected = before[key];
        const store = world.componentMap.get(schema)?.store[key];
        if (typeof expected === "number" && ArrayBuffer.isView(store)) {
          // Compare against the same numeric precision used by ECS storage.
          const normalized: { [index: number]: number } = Reflect.construct(
            store.constructor,
            [1]
          );
          normalized[0] = expected;
          expected = normalized[0];
        }
        const current = component[key];
        const comparable =
          ArrayBuffer.isView(current) && Array.isArray(expected)
            ? Array.from(current as unknown as ArrayLike<number>)
            : current;
        if (isEqual(comparable, expected)) component[key] = cloneDeep(value);
      }
    }
  }
}
