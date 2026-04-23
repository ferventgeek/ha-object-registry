# SPEC.md — Object Registry for Home Assistant

## 1. Data Model

### 1.1 Object Structure

Each registry object is a Python dict with the following fields:

```python
{
    "uuid":        str,   # immutable primary key, generated on create (uuid4)
    "object_id":   str,   # snake_case lookup key, unique, user-defined
    "name":        str,   # friendly display name, unique
    "description": str,   # optional, may be empty string
    "type":        str,   # always "json" in v1
    "created":     str,   # ISO 8601 UTC, e.g. "2026-04-01T14:23:00+00:00"
    "updated":     str,   # ISO 8601 UTC, updated on any field change
    "data":        any    # arbitrary JSON — dict, list, or nested structures
}
```

> NOTE: `type` is reserved for future data types. It is always `"json"` in v1.
> Do not reference other possible values in README, docs, or examples.

> NOTE: `data_version` is NOT an object field. It is set at the Store level
> when initializing `homeassistant.helpers.storage.Store`. See Section 4.

### 1.2 In-Memory Cache

Two dicts are maintained in memory at all times:

```python
# Primary store — source of truth for all object data
_objects: dict[str, dict] = {
    "550e8400-e29b-41d4-a716-446655440000": { ...full object dict... },
    ...
}

# Lookup index — resolves object_id to uuid for service calls
_index: dict[str, str] = {
    "isy_hue_map": "550e8400-e29b-41d4-a716-446655440000",
    ...
}
```

### 1.3 Validation Rules

These rules are enforced on every create and update before any write occurs:

| Field | Rule |
|-------|------|
| `object_id` | Required. Must match `^[a-z0-9_]+$`. Must be unique across all objects. |
| `name` | Required. Must be unique across all objects. |
| `description` | Optional. No format constraint. |
| `data` | Must be valid JSON (deserializable). |
| `uuid` | Generated internally. Never accepted as user input. |
| `created` | Set on create. Never modified after that. |
| `updated` | Set on create. Updated on every subsequent change to any field. |
| `type` | Always set to `"json"`. Never accepted as user input in v1. |

### 1.4 Metadata vs Payload

**Metadata** — returned by `list_items`, included in `get_object`:
`uuid`, `object_id`, `name`, `description`, `type`, `created`, `updated`

**Payload** — returned by `get_item`, included in `get_object`:
`data`

---

## 2. Service Interface

All services are registered under the `object_registry` domain.
They are called from HA automations and scripts via `service: object_registry.<name>`.

### 2.1 `list_items`

Returns metadata for all objects in the registry. No payload data is included.

**Purpose:** Let automations discover what objects exist and find the right
`object_id` before fetching payload data.

**Inputs:** None.

**Output:** A list of metadata dicts, one per object.

```yaml
# Example output (returned as response data)
- uuid: "550e8400-e29b-41d4-a716-446655440000"
  object_id: isy_hue_map
  name: ISY Hue Map
  description: Maps ISY device events to Hue light targets
  type: json
  created: "2026-04-01T14:23:00+00:00"
  updated: "2026-04-03T09:11:00+00:00"
```

**Error cases:** None. Returns empty list if registry is empty.

**Example automation usage:**
```yaml
action:
  - service: object_registry.list_items
    response_variable: all_objects
```

---

### 2.2 `get_item`

Returns the `data` payload for a single object, looked up by `object_id` or `uuid`.

**Purpose:** The primary read operation for automations. Returns only the data
block so automations can use it directly in template expressions.

**Inputs:**

```yaml
fields:
  object_id:
    description: "The snake_case lookup key of the object"
    required: false
    selector:
      text:
  uuid:
    description: "The UUID of the object (alternative to object_id)"
    required: false
    selector:
      text:
```

> NOTE: Exactly one of `object_id` or `uuid` must be provided. If both are
> provided, `object_id` takes precedence. If neither is provided, return an error.

**Output:** The `data` value of the matching object (dict, list, or other JSON).

```yaml
# Example output for object with object_id: isy_hue_map
- "isy.master.bedside_remote_button_ab":
    target: "light.master_bedside"
    faston:
      xy_color: [0.2335, 0.435]
```

**Error cases:**
- `object_id` not found → raise `ServiceValidationError` with message:
  `"No object found with object_id '{object_id}'"`
- `uuid` not found → raise `ServiceValidationError` with message:
  `"No object found with uuid '{uuid}'"`
- Neither input provided → raise `ServiceValidationError` with message:
  `"Must provide either object_id or uuid"`

**Example automation usage:**
```yaml
action:
  - service: object_registry.get_item
    data:
      object_id: isy_hue_map
    response_variable: hue_map
```

---

### 2.3 `get_object`

Returns the full object — both metadata and payload — for a single object.

**Purpose:** Convenience method for cases where automations need both the
metadata (e.g. `updated` timestamp) and the data payload together.

**Inputs:** Same as `get_item` — `object_id` or `uuid`.

**Output:** The full object dict including all metadata fields and `data`.

```yaml
# Example output
uuid: "550e8400-e29b-41d4-a716-446655440000"
object_id: isy_hue_map
name: ISY Hue Map
description: Maps ISY device events to Hue light targets
type: json
created: "2026-04-01T14:23:00+00:00"
updated: "2026-04-03T09:11:00+00:00"
data:
  "isy.master.bedside_remote_button_ab":
    target: "light.master_bedside"
    faston:
      xy_color: [0.2335, 0.435]
```

**Error cases:** Same as `get_item`.

**Example automation usage:**
```yaml
action:
  - service: object_registry.get_object
    data:
      object_id: isy_hue_map
    response_variable: full_object
```

---

## 3. CRUD Operations

All CRUD operations follow this sequence without exception:
1. Validate inputs
2. Update `_objects` (primary dict)
3. Update `_index` (lookup dict)
4. Flush entire `_objects` to Store

### 3.1 Create

1. Validate `object_id` format (`^[a-z0-9_]+$`)
2. Validate `object_id` uniqueness against `_index`
3. Validate `name` uniqueness against all objects in `_objects`
4. Validate `data` is valid JSON
5. Generate `uuid` (uuid4)
6. Set `created` and `updated` to current UTC datetime
7. Set `type` to `"json"`
8. Insert into `_objects[uuid]`
9. Insert into `_index[object_id] = uuid`
10. Flush to Store

**Default values for new objects (shown as placeholders in panel):**
- `name`: `"New Registry Object"`
- `object_id`: `"new_registry_object"`
- `description`: `""` (empty)
- `data`: `{ "key": "value" }`

### 3.2 Update

1. Look up `uuid` via `_index[object_id]` or directly by `uuid`
2. Validate new `object_id` format if changed
3. Validate new `object_id` uniqueness if changed (exclude current object)
4. Validate new `name` uniqueness if changed (exclude current object)
5. Validate `data` is valid JSON
6. Update fields in `_objects[uuid]`
7. If `object_id` changed: remove old key from `_index`, add new key
8. Set `updated` to current UTC datetime
9. Flush to Store

### 3.3 Delete

1. Look up `uuid` via `_index[object_id]` or directly by `uuid`
2. Remove from `_objects[uuid]`
3. Remove from `_index[object_id]`
4. Flush to Store

### 3.4 Concurrency

All CRUD operations run on the HA event loop and are therefore single-threaded.
The validate → update → flush sequence is atomic within a single event loop call.

**Known limitation (v1):** If two users have the same object open in different
browser windows, last-save-wins. The panel detects external changes via
WebSocket and shows a warning banner, but does not prevent the overwrite.
This is documented behavior, not a bug.

---

## 4. Persistence

### 4.1 Store Initialization

```python
from homeassistant.helpers.storage import Store

STORAGE_KEY = "object_registry"
STORAGE_VERSION = 1

store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
```

`STORAGE_VERSION` is the Store-level data version used by HA's migration
framework. It is not exposed in individual object dicts.

### 4.2 Startup (Load)

On integration setup:
1. Call `await store.async_load()`
2. If result is `None` (first run): initialize empty `_objects` and `_index`
3. If result has data: populate `_objects` from stored data, rebuild `_index`
   by iterating `_objects` and mapping each `object_id` to its `uuid`

### 4.3 Flush (Save)

On every CRUD operation after updating the in-memory dicts:
```python
await store.async_save({"objects": list(_objects.values())})
```

The entire object list is written every time. No incremental/partial saves.

### 4.4 Migration

If `STORAGE_VERSION` is incremented in a future release, provide an
`async_migrate` callback to `Store` that transforms the old data format to the
new one. For v1, no migration is needed.

---

## 5. Panel UI Spec

See `docs/wireframes/` for visual reference. This section defines behavior.

### 5.1 List View

A full-width panel registered in the HA sidebar as "Object Registry".

**Table columns (left to right):**
- Icon (project cube logo, decorative, visual anchor)
- Object: `name` (larger, slightly darker) with `description` below
  (slightly less saturated, truncates with ellipsis at column boundary)
- Object ID: `object_id` in snake_case
- Last update: human-friendly relative time (e.g. "3 days ago", "17 hours ago")
- Type: always "JSON" in v1

**Sorting:** Columns are sortable by name, object_id, and last update.
Default sort: last updated, most recent first.

**Row interaction:** Clicking anywhere on a row expands it into edit view.
The chevron icon on the right is a visual affordance only.

**Add item:** FAB button (`+ Add item`) fixed to bottom-right corner.
Clicking adds a new blank row at the bottom of the list and scrolls it into
view, then activates edit view.

**Empty state:** When no objects exist, show a centered message:
"No objects yet. Click '+ Add item' to create one."

**Sidebar badge:** Shows the panel is active/selected. No count badge in v1.

### 5.2 Edit / Add View

Triggered by expanding a row or clicking `+ Add item`. The panel splits:
- **Top ~1/3:** Scrollable list of all objects except the one being edited
- **Bottom ~2/3:** Editor anchored to bottom of panel

The same component handles both edit and add. In add mode, fields show
placeholder default values and the Restore and Delete controls are hidden.

**Editor layout (top to bottom, left-aligned stack):**

1. **Header row** — cube icon | `name*` field + `object_id*` field (side by side)
   | `type` badge (read-only "JSON") aligned to Type column
2. **Description row** — `description` field (full width, shorter than name)
3. **Timestamps row** — `Created:` and `Updated:` read-only text,
   aligned under the Last update column, displayed in HA local timezone
4. **Banner row** — optional, see Section 5.3
5. **JSON editor** — `ha-code-editor` component, fills remaining height
6. **Button row** — full-width, pinned to bottom of editor (see Section 5.4)

**Field details:**

| Field | Required | Editable | Notes |
|-------|----------|----------|-------|
| `name` | Yes (`*`) | Yes | Unique. Placeholder: "New Registry Object" |
| `object_id` | Yes (`*`) | Yes | Unique, snake_case. Placeholder: "new_registry_object" |
| `description` | No | Yes | Placeholder hint text shown when empty |
| `type` | — | No | Read-only display, always "JSON" |
| `created` | — | No | Local timezone, full date and time |
| `updated` | — | No | Local timezone, full date and time |
| `data` | — | Yes | Edited in `ha-code-editor`. Placeholder: `{ "key": "value" }` |

**`object_id` field** is intentionally shorter than `name` to encourage brief
snake_case names that are easy to type in automation YAML.

### 5.3 Banners

Banners appear between the description/timestamps row and the JSON editor.
Left edge aligns with all other editor elements. Right edge aligns with the
end of the Last update column. Goes multi-line if needed.

**Error banner (pink, `--error-color`):**
- Shown when Save validation fails
- Includes warning icon + message text
- Message includes line number if available from `ha-code-editor`
- Blocks save (Save button disabled while error is visible)
- Example: `id 'blue_object' is already in use`
- Example: `object_id must use only lowercase letters, numbers, and underscores`
- Example: `Invalid JSON at line 4`

**Warning banner (amber, `--warning-color`):**
- Shown when a WebSocket event indicates the current object was modified
  externally while the editor is open
- Non-blocking (does not disable Save)
- Text: `"This object was modified in another window. Saving will overwrite
  those changes. Use Restore to load the current version."`
- Fields and editor are NOT updated automatically

### 5.4 Button Row

Full-width row pinned to the bottom of the editor area. Not a floater.

**Edit mode (left to right):**
```
[Delete object]                    [Restore]  [Cancel]  [Save]
```

**Add mode (left to right):**
```
                                              [Cancel]  [Save]
```

**Button behaviors:**

| Button | Style | Enabled when | Action |
|--------|-------|-------------|--------|
| `Save` | Primary (filled) | Any field differs from opened state | Validate → confirm if needed → write |
| `Cancel` | Secondary (outlined) | Always | Discard changes, collapse row |
| `Restore` | Text/subtle | Always (edit mode only) | Reload fields from current cache state |
| `Delete object` | Text, `--error-color` muted, hover brightens | Always (edit mode only) | Confirmation dialog → delete |

### 5.5 Confirmation Dialogs

All confirmations use native `ha-dialog`.

**On Save with object_id change:**
> Title: "Rename object ID?"
> Body: "Changing the object_id from `old_id` to `new_id` may break Automations,
> Scripts, or other integrations that reference `old_id`."
> Buttons: [Cancel] [Confirm rename and save]

**On Delete:**
> Title: "Delete [name]?"
> Body: "This cannot be undone."
> Buttons: [Cancel] [Delete]

**On clicking another object while editing with unsaved changes:**
> Title: "Unsaved changes"
> Body: "You have unsaved changes to [name]. Discard them and open [other name]?"
> Buttons: [Keep editing] [Discard and open]

### 5.6 WebSocket Integration

The panel subscribes to registry change events via HA's WebSocket API on load.
When an event is received for an object that is currently open in the editor,
the warning banner (Section 5.3) is shown. The panel does not need to poll —
the backend fires an event after every successful CRUD operation.

---

## 6. `services.yaml`

```yaml
list_items:
  name: List Items
  description: Returns metadata for all objects in the registry.
  fields: {}

get_item:
  name: Get Item
  description: Returns the data payload for a single object.
  fields:
    object_id:
      name: Object ID
      description: The snake_case lookup key of the object.
      required: false
      selector:
        text:
    uuid:
      name: UUID
      description: The UUID of the object (alternative to object_id).
      required: false
      selector:
        text:

get_object:
  name: Get Object
  description: Returns the full object including metadata and data payload.
  fields:
    object_id:
      name: Object ID
      description: The snake_case lookup key of the object.
      required: false
      selector:
        text:
    uuid:
      name: UUID
      description: The UUID of the object (alternative to object_id).
      required: false
      selector:
        text:
```

---

## 7. Open Questions

Items deferred for future decisions — do not implement until resolved.

| # | Question | Notes |
|---|----------|-------|
| 1 | Exact HA WebSocket event name for registry changes | Determine during `__init__.py` implementation |
| 2 | Whether `ha-code-editor` requires any special import in panel.js | Verify against HA Lollipop frontend source |
| 3 | Config flow — minimal entry only, or does it need options flow? | Likely minimal only; confirm during implementation |
