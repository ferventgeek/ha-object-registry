# ARCHITECTURE.md — Object Registry for Home Assistant

## Overview

The integration has two distinct layers:

- **Backend (Python):** Runs inside HA. Manages the in-memory cache, persists
  data via Store, and exposes service calls for automations and scripts.
- **Frontend (JavaScript):** A vanilla `HTMLElement` custom element served as a
  static file. No Lit dependency, no build step. Renders the sidebar panel and
  communicates with the backend via WebSocket.

These two layers are intentionally decoupled. The backend knows nothing about
the panel. The panel knows nothing about the Store. They communicate only via
WebSocket commands defined in `websocket.py`.

---

## File Map

```
custom_components/object_registry/
│
├── __init__.py       ← Integration entry point
├── manifest.json     ← HA/HACS metadata
├── config_flow.py    ← Minimal config entry (required by HA)
├── const.py          ← Constants: DOMAIN, STORAGE_KEY, etc.
├── registry.py       ← In-memory cache, CRUD operations
├── storage.py        ← Load/save via homeassistant.helpers.storage.Store
├── websocket.py      ← WebSocket command handlers (panel ↔ backend)
├── services.yaml     ← Service definitions (list_items, get_item, get_object)
├── strings.json      ← UI strings for config flow
│
└── frontend/
    └── object-registry-panel.js   ← Vanilla custom element (the sidebar panel)
```

> NOTE: `frontend/` is a subdirectory of the integration folder. It is served
> as a static path by HA's HTTP component. See `__init__.py` for registration.

---

## Component Responsibilities

### `__init__.py`

- Calls `async_setup_entry()` — the HA entry point for config-entry-based integrations
- Instantiates `ObjectRegistry` (from `registry.py`) and stores it on `hass.data`
- Loads persisted data via `storage.py` on startup
- Registers the three service calls (`list_items`, `get_item`, `get_object`)
- Registers WebSocket commands via `websocket.py`
- Registers the sidebar panel and its static file path
- Calls `async_unload_entry()` on shutdown — cleans up services and panel

### `manifest.json`

- Declares domain, name, version, and dependencies
- Required dependencies: `["http", "frontend", "panel_custom"]`
- No external pip requirements (`requirements: []`)

### `config_flow.py`

- Implements the minimum required config flow so HA will load the integration
- Single step: no user input required, just creates the config entry
- Does not expose options flow in v1

### `const.py`

- `DOMAIN = "object_registry"`
- `STORAGE_KEY = "object_registry"`
- `STORAGE_VERSION = 1`
- `PANEL_TITLE = "Object Registry"`
- `PANEL_ICON = "mdi:cube-outline"` (placeholder until final logo)
- WebSocket command type strings

### `registry.py`

- Owns the two in-memory dicts: `_objects` (primary) and `_index` (lookup)
- Exposes methods: `get_all_metadata()`, `get_by_object_id()`, `get_by_uuid()`,
  `async_create()`, `async_update()`, `async_delete()`
- All methods validate inputs before mutating state
- Calls `storage.py` flush after every successful write
- Raises `ValueError` with descriptive messages on validation failure

### `storage.py`

- Wraps `homeassistant.helpers.storage.Store`
- Exposes two methods: `async_load()` and `async_save(data)`
- `async_load()` returns the stored object list or `None` on first run
- `async_save(data)` writes the entire `_objects` dict as a list — no partial saves
- Store is initialized with `STORAGE_VERSION = 1` and `STORAGE_KEY`

### `websocket.py`

- Registers WebSocket command handlers called by the panel
- Commands: `object_registry/list`, `object_registry/get`,
  `object_registry/create`, `object_registry/update`, `object_registry/delete`
- Each handler validates input, calls the appropriate `registry.py` method,
  and sends result or error back to the panel
- Note: the `object_registry_updated` HA event is fired from `registry.py`
  after every successful write, not here — websocket handlers just call registry
  methods and return results

### `services.yaml`

- Defines `list_items`, `get_item`, `get_object` with Fields and Selectors
- These are the automation/script interface — separate from WebSocket
- See SPEC.md Section 6 for full content

### `strings.json`

- UI copy for config flow steps and error messages
- Follows HA's standard strings format

### `frontend/object-registry-panel.js`

- Single-file vanilla `HTMLElement` — no Lit dependency, no build step required
- Registered as `object-registry-panel` via `customElements.define()`
- Uses Shadow DOM for style isolation
- Receives `hass` object from HA frontend (set as property automatically)
- `set hass` only triggers a load on first render or DOM wipe — never re-renders
  on HA state heartbeats, which would destroy editor focus
- Uses HA CSS custom properties for all colors, typography, and button styles
- Uses `ha-code-editor` (CM6) for JSON editing — created programmatically
  before DOM append to avoid Lit async init timing issues
- Uses native `<dialog>` element for confirmation dialogs
- Communicates with backend exclusively via `this._hass.callWS({type: ...})`
- Subscribes to `object_registry_updated` events for concurrent edit detection
- Module-scope `visibilitychange` listener handles tab return after Chrome
  background throttling — see Known Quirks below

---

## Data Flow

### Startup

```
HA loads integration
  → __init__.async_setup_entry()
    → storage.async_load()
      → reads Store JSON from disk
    → registry.load(data)
      → populates _objects and rebuilds _index
    → registers services (list_items, get_item, get_object)
    → registers WebSocket commands
    → registers static path for frontend/
    → registers sidebar panel
```

### Automation reads an object

```
automation calls service: object_registry.get_item
  → __init__ service handler
    → registry.get_by_id(object_id)
      → looks up uuid in _index
      → returns _objects[uuid]["data"]
    → returns data as service response
```

### Panel creates an object

```
panel calls this._hass.callWS({type: "object_registry/create", ...})
  → websocket.websocket_create()
    → registry.create(data)
      → validates object_id, name, data
      → generates uuid
      → inserts into _objects and _index
      → storage.async_save(_objects)
        → writes entire object list to Store
      → fires "object_registry_updated" event
    → sends result back to panel
panel receives result → re-renders list
other open panels receive event → show warning banner if editing same object
```

### Panel updates an object

```
panel calls this._hass.callWS({type: "object_registry/update", ...})
  → websocket.websocket_update()
    → registry.update(uuid, changes)
      → validates uniqueness, format, JSON validity
      → updates _objects[uuid]
      → updates _index if object_id changed
      → sets updated timestamp
      → storage.async_save(_objects)
      → fires "object_registry_updated" event
    → sends result back to panel
```

---

## Panel Registration Pattern

From `__init__.py`:

```python
from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
import os

PANEL_URL = f"/{DOMAIN}_panel"

async def async_register_panel(hass):
    # Avoid duplicate registration
    if DOMAIN in hass.data.get("frontend_panels", {}):
        return

    panel_path = os.path.join(os.path.dirname(__file__), "frontend")

    await hass.http.async_register_static_paths([
        StaticPathConfig(PANEL_URL, panel_path, cache_headers=False)
    ])

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="object-registry-panel",
        frontend_url_path=DOMAIN,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{PANEL_URL}/object-registry-panel.js",
        embed_iframe=False,
        require_admin=False,
    )
```

> NOTE: `webcomponent_name` must exactly match the name passed to
> `customElements.define()` in `object-registry-panel.js`.

---

## WebSocket Command Names

| Command type string      | Handler            | Action                                       |
| ------------------------ | ------------------ | -------------------------------------------- |
| `object_registry/list`   | `websocket_list`   | Returns all objects (metadata only)          |
| `object_registry/get`    | `websocket_get`    | Returns one full object by object_id or uuid |
| `object_registry/create` | `websocket_create` | Creates a new object                         |
| `object_registry/update` | `websocket_update` | Updates an existing object                   |
| `object_registry/delete` | `websocket_delete` | Deletes an object                            |

> NOTE: These are internal panel ↔ backend commands, distinct from the
> automation service interface (`list_items`, `get_item`, `get_object`).
> Do not conflate them.

---

## Key Design Decisions

**Why WebSocket for the panel, not REST?**
HA's panel architecture expects WebSocket. The `hass.callWS()` method is the
standard pattern for custom panels to communicate with their backend. REST
would require registering additional HTTP endpoints, which is non-standard.

**Why a separate `websocket.py`?**
Keeps `__init__.py` focused on setup and teardown. WebSocket handlers are
verbose (schema validation, error handling, response formatting) and would
clutter the entry point if inlined.

**Why `const.py`?**
Magic strings scattered across files are a maintenance headache. A single
constants file makes domain, storage key, and WebSocket command names easy
to find and change in one place.

**Why no build step for the panel JS?**
A build step (webpack, rollup) adds toolchain complexity that is hostile to
weekend coders trying to contribute. HA's frontend serves the modern ES module
build, so we can write modern JavaScript directly and import HA's own components
without bundling.

**Why is the `visibilitychange` listener at module scope, not in `connectedCallback`?**
After ~5 minutes in a background tab, Chrome throttles JS execution and HA's
`partial-panel-resolver` removes `<object-registry-panel>` from the DOM entirely.
Any listener attached in `connectedCallback` dies with the element. By registering
the listener at module scope (outside the class, before `customElements.define()`),
it survives element removal and persists for the page lifetime. On tab return, it
dispatches HA's own `location-changed` event (not `popstate` — HA's Lit router
ignores that) to navigate away and back, forcing a clean remount. A `setTimeout`
of 100ms between the two dispatches gives the Lit router one tick to process
the navigate-away before the navigate-back arrives. The guard
`window._objectRegistryVisibilityHandler` prevents double-registration across
hot reloads.

---

## Known Quirks

### `ha-code-editor` height in Shadow DOM

`ha-code-editor` is a Lit element wrapping CodeMirror 6. Getting it to fill its
container height requires injecting CSS directly into its Shadow DOM after it
renders. This is done via a `setTimeout(() => { editor.shadowRoot.appendChild(style) }, 0)`
in `_render()`. The target classes are `.cm-editor` (flex column) and
`.cm-scroller` (flex: 1, overflow: auto). This is tribal knowledge — nothing in
the CM6 or HA docs explains it.

---

## Pre-Publish Checklist

| Item                                | Status      | Notes                           |
| ----------------------------------- | ----------- | ------------------------------- |
| `const.py`                          | ✅ Complete |                                 |
| `registry.py`                       | ✅ Complete |                                 |
| `storage.py`                        | ✅ Complete |                                 |
| `websocket.py`                      | ✅ Complete |                                 |
| `__init__.py`                       | ✅ Complete |                                 |
| `frontend/object-registry-panel.js` | ✅ Complete |                                 |
| `README.md`                         | ✅ Complete |                                 |
| `hacs.json`                         | ⬜ Needed   | Fill in before HACS submission  |
| `.github/workflows/validate.yml`    | ⬜ Needed   | hassfest + HACS validation CI   |
| `examples/basic_usage.yaml`         | ⬜ Needed   | Real ISY/Hue example automation |
| First tagged release (`v0.1.0`)     | ⬜ Needed   | Required for HACS submission    |
