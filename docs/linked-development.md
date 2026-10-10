
## Game hot reload

Opt in with `yage({ hotReload: true })` in the game's Vite configuration. Engine
source edits still use the existing full page reload. Hot reload transforms run
only in the development server, leaving production registration unchanged.

Game modules that import the named `System` decorator (including an alias) from
`minecs` and use `@System(...)` accept updates. Changes to their imported helpers
also propagate to that module. YAGE applies updated implementations before the
next simulation or drawing frame, preserving the world, component data, cached
system references and exported constructor identity. Simulation systems retain
non-function instance fields; fresh methods and function fields use the updated
implementation. Drawing systems call the old cleanup for matching entities and
start a fresh instance, allowing retained presentation to rebuild.

JSON, JSON5 and JSONC files under a game's `entities/` directory accept updates
to a single named entity definition. At the next frame, YAGE rebuilds the entity
factory from the latest authored definitions, including inheritance. Existing
entities receive each changed default only while its current field still equals
the previous default. Gameplay-modified fields are preserved; subsequent spawns
use all updated defaults. This also covers inherited and omitted schema defaults.
Adding/removing template components affects subsequent spawns; existing component
membership is preserved. Only literal defaults are patched; template expressions
are resolved normally for subsequent spawns.
System query, category, depth and frame scheduling changes also update live;
YAGE rebuilds query membership, ordering and cached lookups at the frame seam.
Renaming an entity, changing a system's class set or switching between simulation
and drawing invalidates the update and falls back to a page reload. File
additions/deletions and component schema edits use Vite's normal invalidation.

Use this loop in a local single-player development session. Hot updates do not
synchronize implementation changes with multiplayer peers. Simulation methods
that install callbacks outside the system need explicit lifecycle handling:
replacing a method cannot update callbacks already captured by other modules.
