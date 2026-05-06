# DESIGN.md — Object Registry for Home Assistant

## Problem Statement

Home Assistant is a powerful automation platform, but I felt there was a small gap for my workflow:
native reusable, structured mapping data that
automations and scripts can look up at runtime. The typical workaround is to
hardcode edge cases directly in automation YAML, which at scale (or in time) can become
hard to maintain as the number of devices and relationships grows.

A concrete example: a home using an ISY/Eisy controller for legacy Insteon and
Z-Wave devices alongside newer HA-native devices. Connecting ISY device events
(button presses, fast-on signals, press-and-hold dimming) to the correct HA
action requires a mapping layer. Without a registry, that mapping lives as
hardcoded YAML spread across dozens of automations. With a registry, an
automation can call `object_registry.get_item` with `object_id: isy_hue_map`,
get back the mapping data, and act on it dynamically — making the automation
short, readable, and reusable across any number of devices.

`object_registry` provides that mapping layer.

## What It Is

A Home Assistant custom integration that provides:

- An **in-memory registry** of named JSON objects, accessible from automations
  and scripts via HA service calls
- A **custom sidebar panel** built as a vanilla `HTMLElement` — no Lit
  dependency, no build step — for creating and editing objects without touching
  YAML or config files
- **Persistent storage** via HA's native `homeassistant.helpers.storage.Store`
  interface (JSON on disk, loaded into memory at startup)
- **HACS distribution** for easy community installation

## What It Is Not

- Not a database. A lightweight in-memory store for configuration-style mapping
  data, not for transactional or high-volume data.
- Not a real HA entity provider. Objects have an `object_id` lookup key as a
  convenience but do not appear in HA's state machine, Lovelace, or Developer
  Tools → States.
- Not a scripting engine. The registry provides data. What automations do with
  that data is the user's responsibility and outside our support scope.
- Not backwards-compatible. Targets HA 2026.4+. Older versions not supported.

## Design Philosophy

### Readability over cleverness

Every file should be understandable by a capable weekend coder who knows Python
basics but is not an expert. If a pattern requires explanation, replace it with
something simpler or document it with a plain-language comment. This should be
clear, well-organized code, advanced Python or JavaScript technique.

### Minimal support surface

The service interface is intentionally narrow: `list_items`, `get_item`,
`get_object`. We do not expose internal implementation details, provide helper
methods for processing returned data, or accept automation logic as input.

This boundary is critical: when a user files a GitHub issue, I want to help users
delineate where an issue might lie at the outset. Is HA-specific or from the Object Registry specifically?
Ambiguity of that demarcation can frustrate users and a narrow interface makes that line more obvious.
I'm not an HA expert by any means and if there's an implementation issue which can be solved

### One file, one job

Each Python file has a single clearly-stated responsibility. `registry.py`
manages the in-memory cache. `storage.py` handles persistence. `config_flow.py`
handles the HA config entry requirement. Nothing crosses those boundaries.

### HA conventions everywhere

We follow HA's own patterns for every interface: async setup, config entries,
the Store interface, service registration, HA design tokens, native HA
widgets (`ha-code-editor`, `ha-alert`), and vanilla custom elements that
feel at home alongside HA's Lit-based frontend. A developer familiar with
HA internals should feel at home immediately.

### Validate on submit, never on keystroke

Form validation fires only when the user clicks Save. No live validation while
typing. This applies to `object_id` format, uniqueness checks, and JSON
validity. Save is enabled as soon as any field changes from its opened state —
format and uniqueness are enforced at submit time.

## GUI Design

The management UI is a **custom sidebar panel** using HA's Lollipop frontend
conventions (HA design tokens, native HA widgets wherever possible). Built as
a vanilla `HTMLElement` — no Lit dependency, no build step. It has two views:

**List view:** A sortable table of all objects showing name, description,
object_id, last updated (human-friendly), and type. Rows are accordion-style —
clicking anywhere on a row expands it into the editor. An `+ Add item` FAB
button is in the bottom right corner.

**Edit/Add view:** The panel splits into top ~1/3 (scrollable list of all other
objects) and bottom ~2/3 (the editor anchored to the bottom). The editor shows:

- Metadata fields: `name*`, `object_id*` (side by side), `description` (full width)
- Read-only display: `Created` and `Updated` timestamps (local timezone)
- Optional banner: error (pink) or concurrent-edit warning (amber)
- `ha-code-editor` for the JSON data payload
- Full-width button row pinned to bottom: `[Delete object]` left,
  `[Restore] [Cancel] [Save]` right

Add and Edit use the same view. Add mode shows placeholder defaults and omits
the Restore and Delete controls.

**Key interaction rules:**

- Save is disabled until any field differs from its opened state
- All validation (uniqueness, snake_case format, valid JSON) fires on Save only
- Changing `object_id` on Save triggers a confirmation dialog warning it may
  break existing Automations or Scripts
- Delete triggers a confirmation dialog: "Delete [name]? This cannot be undone."
- Concurrent edit detected via WebSocket: amber warning banner appears in-place
  without re-rendering the editor — fields are NOT updated automatically,
  Restore fetches current cache state
- Clicking another object while editing with unsaved changes triggers a
  confirmation dialog before switching
- HA fires `set hass` on every entity state change system-wide — the editor
  never re-renders in response to this, preserving focus and unsaved input

**Native HA components used:**

- `ha-code-editor` — JSON payload editor (CodeMirror 6, themed, line numbers, fullscreen)
  Created programmatically before DOM append to avoid Lit async timing issues.
  CM6 sized via Shadow DOM style injection (see ARCHITECTURE.md Known Quirks).
- Native `<dialog>` element for confirmation dialogs (not `ha-dialog`)
- HA design tokens (`--primary-color`, `--card-background-color`,
  `--secondary-background-color`, `--primary-text-color`, `--error-color`,
  `--warning-color`, `--divider-color`, `--disabled-text-color`)
- Button styles match HA Lollipop pill conventions (rounded, hover states)

## GUI Strategy

**Phase 1 (complete):** Custom sidebar panel — full management UI as described
above. Config flow is minimal (required by HA to load the integration) but the
panel is the primary user interface. Built as a vanilla `HTMLElement` (no Lit
dependency) for simplicity and no build step requirement.

**Phase 2 (future):** JSON editor resize handle — drag to resize the editor
height within the split panel. Noted here to manage GitHub requests; not in
scope for v1.

## Success Criteria

1. A user can install via HACS in under 5 minutes
2. A user can create an object via the sidebar panel without touching any files
3. An automation can look up an object by `object_id` in a single service call
4. The returned data is immediately usable in HA template expressions
5. The codebase can be understood by reading each file top to bottom, once,
   without external references

## Non-Goals

- Processing or transforming registry data inside the integration
- Supporting multiple integrations per repository
- Backwards compatibility with HA versions prior to 2026.4
- Query language, filtering, or search beyond lookup by `object_id` or `uuid`
- Real-time sync between multiple HA instances
- JSON editor resize handle (Phase 2, not v1)
- Additional object types beyond `json` (future, not v1 — do not hint at this
  in README or examples)
