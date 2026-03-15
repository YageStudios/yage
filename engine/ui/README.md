# engine/ui/ - UI Mapping Systems

This directory contains two parallel UI mapping systems for building reactive user interfaces from declarative definitions. Both systems ultimately produce trees of `UIElement` instances (`Box`, `Text`, `Button`, `TextInput`, `ImageBox`) and support data binding with automatic updates when context changes.

## Table of Contents

- [Shared Infrastructure](#shared-infrastructure)
- [UiMap (JSON5 System)](#uimap-json5-system)
- [UiMapNext (Handlebars/HTML System)](#uimapnext-handlebarshtml-system)
- [Feature Comparison](#feature-comparison)
- [Element Types](#element-types)

---

## Shared Infrastructure

Both systems share:

| File           | Purpose                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `UiConfigs.ts` | `createByType()` factory — maps `"box"`, `"text"`, `"button"`, `"input"`, `"image"` strings to element constructors |
| `UIElement.ts` | Base class for all UI elements. Manages config, children, focus, events, destroy lifecycle                          |
| `Box.ts`       | Container element with default absolute positioning and transparent background                                      |
| `Text.ts`      | Text display element (`label` config property)                                                                      |
| `Button.ts`    | Clickable button element                                                                                            |
| `TextInput.ts` | Text input field                                                                                                    |
| `ImageBox.ts`  | Image display element                                                                                               |
| `Rectangle.ts` | `Position` and `Rectangle` classes for layout                                                                       |
| `UIService.ts` | Singleton service for DOM-level UI management                                                                       |
| `utils.ts`     | `positionToCanvasSpace()`, `scaleFont()` helpers                                                                    |

---

## UiMap (JSON5 System)

**File:** `UiMap.ts`

The original UI system. Definitions are written as JSON objects (typically JSON5 for comments and trailing commas). Supports both legacy `$$variable` syntax and the newer `{{ expression }}` syntax.

### API

```ts
import { buildUiMap } from "yage/ui/UiMap";

const uiMap = buildUiMap(json, boxPosition?, boxConfig?);

// Build the UI tree with initial context
const elements = uiMap.build(context, eventHandler);

// Update with partial context (merges into existing)
uiMap.update({ hp: 50 });

// Read the current context snapshot
const ctx = uiMap.context();
```

`buildUiMap()` returns `{ build, update, context }`:

- **`build(context, eventHandler)`** — Recursively traverses the JSON, creates `UIElement` instances, resolves data bindings, and returns a map of `{ [key]: UIElement }`. If `boxPosition` was provided, wraps everything in a root `Box`.
- **`update(partialContext)`** — Merges partial context into the stored context, then iterates all registered queries and calls their pointer functions to update element properties.
- **`context()`** — Returns a deep clone of the current build context.

### JSON Definition Format

Each top-level key in the JSON represents a named UI element:

```json5
{
  healthBar: {
    type: "box",
    rect: { x: 10, y: 10, width: 200, height: 30 },
    config: {
      style: { backgroundColor: "red" },
    },
    children: {
      label: {
        type: "text",
        rect: { x: 0, y: 0, width: "100%", height: "100%" },
        config: { label: "$$hp" },
      },
    },
  },
}
```

**Required fields per element:**

- `type` — One of `"box"`, `"text"`, `"button"`, `"input"`, `"image"`, `"grid"`, or `"template"`
- `rect` — `{ x, y, width, height }` (supports numeric or string values like `"100%"`)
- `config` — Element-specific configuration (styles, label, events, etc.)

**Optional fields:**

- `children` — Nested object of child element definitions
- `events` — Event handler mappings (see [Events](#events))

### Data Binding: Legacy `$$` Syntax

Prefix a context variable path with `$$` to bind it:

```json5
{
  config: {
    label: "$$playerName", // full replacement
    label: "HP: $$stats.hp", // partial replacement (string interpolation)
    label: "$$deep.nested.value", // dot-notation path access
  },
}
```

- **Full replacement:** When the entire value is `$$var`, the value is replaced with the context value directly (preserving type).
- **Partial replacement:** When `$$var` appears within a larger string, only that portion is substituted and the result is always a string.
- Dot-notation paths are resolved using lodash `get()`.

### Data Binding: Expression `{{ }}` Syntax

The newer expression syntax supports arbitrary JavaScript expressions:

```json5
{
  config: {
    label: "{{ hp }}", // simple variable lookup
    label: "{{ hp * 2 }}", // arithmetic
    label: "{{ hp > 50 ? 'OK' : 'Low' }}", // ternary
    label: "HP: {{ player.hp }}/{{ player.maxHp }}", // multi-interpolation
  },
}
```

**Type preservation:** When the entire string is a single `{{ expr }}`, the raw evaluated value is returned (number, boolean, etc.). When multiple interpolations or surrounding text exist, the result is a string.

**Expression evaluation** uses `new Function` with `with(ctx)` for direct variable access. Expressions are compiled once and cached.

**Security sandboxing:** The following globals are blocked (shadowed as `undefined`): `window`, `document`, `eval`, `Function`, `globalThis`, `self`, `top`, `parent`, `frames`.

### Structural Nodes

Structural nodes control conditional rendering and context scoping. They are placed where a regular element would go in the `children` object.

#### `$if` / `$unless`

```json5
{
  children: {
    conditional: {
      $if: "isAlive", // expression string evaluated against context
      then: {
        // rendered when condition is truthy
        type: "text",
        rect: { x: 0, y: 0, width: 100, height: 20 },
        config: { label: "Alive" },
      },
      else: {
        // (optional) rendered when condition is falsy
        type: "text",
        rect: { x: 0, y: 0, width: 100, height: 20 },
        config: { label: "Dead" },
      },
    },
  },
}
```

`$unless` works identically but with inverted logic (renders `then` when the expression is falsy).

On `update()`, the condition is re-evaluated. If the result changes, the old branch is destroyed and the new branch is built.

#### `$with`

```json5
{
  children: {
    scoped: {
      $with: "player.stats", // dot-path into context
      content: {
        // rendered with scoped context
        type: "text",
        rect: { x: 0, y: 0, width: 100, height: 20 },
        config: { label: "{{ hp }}" }, // resolves from player.stats.hp
      },
    },
  },
}
```

The `$root` variable is injected into the scoped context, pointing to the top-level build context.

#### `$partial`

```json5
{
  children: {
    reused: {
      $partial: "myTemplateName", // name from registerTemplate()
      context: "player.stats", // (optional) scoped context path
    },
  },
}
```

Partials reference templates registered via `registerTemplate()`. If the named template is not found, a console warning is emitted.

### Grid

Grids render a list of items using a repeated element template:

```json5
{
  inventory: {
    type: "grid",
    rect: { x: 0, y: 0, width: 400, height: 300 },
    config: { gap: "4px" },
    items: "$$items",
    element: {
      type: "box",
      rect: { x: 0, y: 0, width: 80, height: 80 },
      config: {
        label: "{{ name }}",
      },
    },
  },
}
```

Grid children automatically receive:

- **`$context`** — The parent context (the context of the grid's container)
- **`$index`** — The item's numeric index (0-based)
- **`$root`** — The top-level build context
- All properties from the item object are merged into the child context

Grid uses flex-wrap layout. When items shrink, excess child elements are destroyed. When items match, children with unchanged contexts are skipped.

### Templates

Reusable JSON fragments registered globally:

```ts
import { registerTemplate } from "yage/ui/UiMap";

registerTemplate("healthBar", {
  bar: {
    type: "box",
    rect: { x: 0, y: 0, width: 200, height: 20 },
    config: { label: "$$hp" },
  },
});
```

Referenced via `type: "template"`:

```json5
{
  hpDisplay: {
    type: "template",
    config: { template: "healthBar.bar" },
    context: { hp: "$$currentHp" },
  },
}
```

The `context` object maps template variables to values from the current context. Config and rect can be overridden.

### CSS Classes

```ts
import { registerUiClass } from "yage/ui/UiMap";

registerUiClass("danger", { color: "red", fontWeight: "bold" });
```

Applied via `config.class`:

```json5
{ config: { class: "danger highlight" } }
```

Multiple classes are space-separated. Class styles are merged under element styles.

### Inline CSS Strings

When `config.style` is a string instead of an object, it is parsed as CSS:

```json5
{
  config: {
    style: "background-color: red; font-size: 14px; width: {{ w }}px",
  },
}
```

Kebab-case properties are converted to camelCase. Expressions inside values are evaluated.

### Events

```json5
{
  events: {
    click: "onHealthClick",
    escape: "onCancel",
    mouseDown: "onPress",
    mouseUp: "onRelease",
    mouseEnter: "onHover",
    mouseLeave: "onLeave",
    hoverFocus: "onHoverFocus",
    hoverBlur: "onHoverBlur",
    blur: "onBlur",
    focus: "onFocus",
    trigger: "onTrigger",
  },
}
```

Event names are passed to the `eventHandler` callback provided to `build()`:

```ts
(playerIndex: number, eventName: string, eventType: string, context: any) => void
```

### Reactivity Model

The current update model is **O(N)** — `update()` iterates ALL registered queries and calls every pointer function, regardless of which context properties changed.

A **granular reactivity** system is partially implemented (dependency extraction via `extractDeps()`), gated behind the `USE_UIMAP_GRANULAR_REACTIVITY` feature flag:

```ts
import { setUiMapGranularReactivity } from "yage/ui/UiMap";
setUiMapGranularReactivity(true);
```

When fully implemented, this will achieve O(C+D) complexity (C = changed properties, D = dependent elements).

### Special Variables

| Variable   | Available In                        | Description                              |
| ---------- | ----------------------------------- | ---------------------------------------- |
| `$root`    | `$with` scoped contexts, grid items | Reference to the top-level build context |
| `$index`   | Grid item contexts                  | 0-based index of the current item        |
| `$context` | Grid item contexts                  | The parent context (grid's own context)  |

---

## UiMapNext (Handlebars/HTML System)

**File:** `UiMapNext.ts`

The newer class-based UI system. Definitions are written as HTML/Handlebars template strings. Uses an internal tokenizer and parser to build an AST, then renders AST nodes into UIElement trees.

### API

```ts
import { UiMapNext } from "yage/ui/UiMapNext";

const ui = new UiMapNext(templateString, partials?);

// Build the UI tree
const rootElement = ui.build(context, eventHandler?);

// Update with new context
ui.update({ hp: 50 });

// Get the root element
const root = ui.getRootElement();
```

Constructor arguments:

- **`template`** — HTML/Handlebars template string
- **`partials`** — Optional `Record<string, string>` or `Map<string, string>`. Defaults to `UiLoader.getInstance().hbsLibrary`.

### Template Syntax

Templates use HTML-like tags with capitalized element names:

```html
<Box x="10" y="10" width="200" height="30" style="background-color: red">
  <Text x="0" y="0" width="100%" height="100%"> HP: {{ hp }} </Text>
</Box>
```

**Supported tags:** `Box`, `Text`, `Button`, `Input`, `Image`, `Grid`

Tag names are lowercased before passing to `createByType()` (so `<Box>` creates a `"box"` type, etc.), except `Grid` which directly creates a `Box` with flex-wrap grid styling.

Self-closing tags are supported: `<Box style="..." />`.

### Expressions

```html
<Text>{{ hp }}</Text>
<Text>{{ hp * 2 + shield }}</Text>
<Text>{{ isAlive ? "Alive" : "Dead" }}</Text>
<Box style="width: {{ healthPercent }}%">...</Box>
```

Expression evaluation uses `new Function("$root", "context", "return " + transformedExpression)`. Variable paths in expressions are rewritten to `context.path.to.variable` form before compilation.

### Conditionals

#### `{{#if}}`

```html
{{#if isAlive}}
<Text>Player is alive</Text>
{{else}}
<Text>Game Over</Text>
{{/if}}
```

#### `{{#unless}}`

```html
{{#unless gameOver}}
<Text>Still playing</Text>
{{/unless}}
```

Both create container `Box` elements. On update, if the condition changes, children are destroyed and the appropriate branch is re-rendered.

### Context Scoping: `{{#with}}`

```html
{{#with player.stats}}
<Text>HP: {{ hp }}</Text>
<Text>MP: {{ mp }}</Text>
{{/with}}
```

Resolves variables relative to the scoped path. The context path is updated so `hp` resolves to `player.stats.hp` in the root context.

### Partials

#### Basic Partial

```html
{{> myPartial}} {{> myPartial player.stats}}
```

The second form scopes the partial to a sub-path of the context.

#### Partial Block (with fallback)

```html
{{#> myPartial}}
<Text>Fallback if partial not found</Text>
{{/myPartial}}
```

#### Inline Partial

```html
{{#*inline "myWidget"}}
<Box><Text>Widget content</Text></Box>
{{/inline}} {{> myWidget}}
```

Inline partials are registered into the current partials map and can be referenced later.

#### Dynamic Partials

```html
{{> (partialName) }}
```

The expression inside parentheses is evaluated to determine the partial name at runtime.

Partials are sourced from `UiLoader.getInstance().hbsLibrary` by default, or from the `partials` constructor argument.

### Grid

```html
<Grid x="0" y="0" width="400" height="300" items="{{ items }}" gap="4px">
  <Box style="position: relative; flex: 0 0 auto">
    <Text>{{ this.name }}</Text>
  </Box>
</Grid>
```

Child elements are repeated for each item. Within grid children:

- **`this`** — The current item object
- **`this.propertyName`** — Access item properties
- **`$index`** — The current item index
- **`$root`** — The root context

### Attributes

Attributes map directly to element config properties:

```html
<Text
  x="10"
  y="20"
  width="200"
  height="30"
  label="Hello"
  style="color: white; font-size: 14px"
  focusStyle="color: yellow"
  hoverStyle="color: cyan"
>
  Direct text content sets label
</Text>
```

**Position attributes:** `x`, `y`, `width`, `height`, `maxWidth`, `maxHeight`, `minWidth`, `minHeight`, `xOffset`, `yOffset`

**Style attributes:** `style`, `focusStyle`, `hoverStyle`, `activeStyle`, `disabledStyle` — when provided as strings, they are parsed from CSS format (`"key: value; ..."`) into camelCase objects.

**Event attributes:** `onclick`, `onmousedown`, `onmouseup`, `onmouseenter`, `onmouseleave`, `onfocus`, `onblur`, `onescape` — values are event names passed to the `eventHandler` callback:

```ts
(playerIndex: number, eventName: string, eventType: string, context: any, contextPath: string[]) => void
```

### Reactivity Model

UiMapNext uses **granular dependency tracking** with O(C+D) update complexity:

1. **`variableDependencies`** — `Map<string, Set<string>>` mapping full variable paths to sets of element IDs that depend on them.
2. **`functionPointers`** — `Map<string, Map<string, () => void>>` mapping element IDs to per-variable-path update functions.

On `update()`:

1. New context is merged with existing context.
2. Changed variables are detected by comparing old and new context values (using lodash `isEqual`).
3. Only the update functions for elements that depend on changed variables are invoked.

### Special Variables

| Variable    | Available In       | Description                                                                           |
| ----------- | ------------------ | ------------------------------------------------------------------------------------- |
| `$root`     | Everywhere         | Reference to the top-level build context (passed as first arg to evaluated functions) |
| `$index`    | Grid item contexts | 0-based index of the current grid item                                                |
| `this`      | Grid item contexts | The current item object                                                               |
| `this.prop` | Grid item contexts | Access a property of the current item                                                 |

### AST Node Types

The internal parser produces these AST node types:

| Type            | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `Program`       | Root container, holds `body: ASTNode[]`                                        |
| `Element`       | HTML-like tag with `tag`, `attributes`, `children`, `key`                      |
| `Text`          | Text content (may contain `{{ }}` expressions)                                 |
| `Partial`       | `{{> name }}` with optional `contextVariable`, `params`, `children`            |
| `InlinePartial` | `{{#*inline "name"}}...{{/inline}}`                                            |
| `ScopedBlock`   | `{{#with var}}...{{/with}}`                                                    |
| `IfBlock`       | `{{#if cond}}...{{else}}...{{/if}}` with `consequent` and optional `alternate` |
| `UnlessBlock`   | `{{#unless cond}}...{{/unless}}` with `body`                                   |

---

## Feature Comparison

| Feature                 | UiMap (JSON5)                                          | UiMapNext (HBS)                                                         |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Definition format       | JSON/JSON5 objects                                     | HTML/Handlebars strings                                                 |
| Variable binding        | `$$var` and `{{ expr }}`                               | `{{ expr }}` only                                                       |
| Expression evaluation   | `new Function` + `with(ctx)`                           | `new Function("$root", "context", ...)` with path rewriting             |
| Expression caching      | Yes (`expressionCache` Map)                            | Yes (`cachedExpressions` Map)                                           |
| Security sandboxing     | Blocked globals list                                   | No explicit sandbox                                                     |
| Conditionals            | `$if` / `$unless` structural nodes                     | `{{#if}}` / `{{#unless}}` blocks                                        |
| Context scoping         | `$with` structural node                                | `{{#with}}` block                                                       |
| Partials / templates    | `registerTemplate()` + `$partial` / `type: "template"` | `{{> partial}}`, `{{#> block}}`, `{{#*inline}}`, dynamic `{{> (expr)}}` |
| Grid                    | `type: "grid"` with `items` + `element`                | `<Grid items="...">` with child templates                               |
| Inline CSS parsing      | Yes (`parseCssString`)                                 | Yes (`generateStyleAttribute`)                                          |
| CSS classes             | `registerUiClass()` + `config.class`                   | Not supported                                                           |
| Reactivity              | O(N) full scan (granular planned)                      | O(C+D) granular dependency tracking                                     |
| Update method           | `update(partialContext)` merges & scans all queries    | `update(newContext)` merges & updates only affected elements            |
| `$root`                 | In `$with` and grid contexts                           | Everywhere                                                              |
| `$index`                | In grid item contexts                                  | In grid item contexts                                                   |
| `this`                  | Not supported                                          | In grid item contexts                                                   |
| Events                  | `events` object on element                             | `onclick`, `onmousedown`, etc. attributes                               |
| Event handler signature | `(playerIndex, eventName, eventType, context)`         | `(playerIndex, eventName, eventType, context, contextPath)`             |

---

## Element Types

All element types are shared between both systems via `createByType()` in `UiConfigs.ts`:

| Type String          | Class       | Key Config Properties                 |
| -------------------- | ----------- | ------------------------------------- |
| `"box"`              | `Box`       | `style`, `children`, `renderOnScroll` |
| `"text"`             | `Text`      | `label`, `style`                      |
| `"button"`           | `Button`    | `label`, `style`, `onClick`           |
| `"input"`            | `TextInput` | `label`, `style`                      |
| `"image"`            | `ImageBox`  | `style`, image-specific config        |
| `"animatedImageBox"` | —           | Throws "not supported" error          |