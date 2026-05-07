# CLAUDE.md — Object Registry for Home Assistant

## What This Project Is

`object_registry` is a Home Assistant custom integration that provides a named,
in-memory object registry accessible from HA automations and scripts via service
calls. Objects are JSON structures (Python dicts in memory) persisted via HA's
native `homeassistant.helpers.storage.Store` interface. Managed via a custom
sidebar panel built as a vanilla `HTMLElement` — no Lit dependency, no build
step. Distributed via HACS and GitHub.

## Current Status

> **Update this section at the start of every working session.**

Phase: **v1 feature complete — ready for public feedback**
Working on: `examples/basic_usage.yaml`, then HACS default store submission.
Recent: All bugs fixed (focus loss in editor, disappearing panel after tab throttling).
All docs locked (ARCHITECTURE, DESIGN, SPEC, README). CI green (hassfest + HACS validation passing).
Next: Write ISY automation example, tag `v0.1.0`, submit to HACS default store.

## Canonical Docs — Read These First

| Doc                    | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `docs/DESIGN.md`       | Goals, constraints, philosophy, non-goals             |
| `docs/SPEC.md`         | Data model, service contracts, UI spec                |
| `docs/ARCHITECTURE.md` | Component map, file responsibilities, data flow       |
| `docs/wireframes/`     | UI mockups — source of truth for panel implementation |

When these docs conflict, `SPEC.md` wins for code decisions.
When anything is ambiguous, ask before assuming — put the answer back in the docs.

## Target Environment

- **Home Assistant version:** 2026.4
- **Python:** 3.12+
- **Distribution:** HACS + GitHub
- **No external pip dependencies** — HA built-in interfaces only

## Core Constraints — Never Violate These

1. **Readability first.** Code must be understandable by weekend HA developers.
   No clever patterns, no advanced meta-programming, no obscure stdlib tricks.
2. **Vanilla Python.** No external deps. Use only HA built-in interfaces.
3. **Minimal support surface.** Service interface is intentionally narrow.
   Do not add flexibility that's unfriendly and drives support issues.
4. **HA conventions.** Follow HA core patterns throughout — storage, config flow,
   service registration, async, HA design tokens, native HA widgets. Panel is
   a vanilla `HTMLElement` — no Lit dependency, no build step.
5. **No backwards compatibility for first release.** Targets HA 2026.4+ only.
6. **Validate on submit, never on keystroke.** No live form validation.

## Integration Domain

`object_registry` — fixed, matches `custom_components/` folder name and
`domain` key in `manifest.json` exactly. Cannot be changed after publishing.

## File Responsibilities

| File                                | Responsibility                                             |
| ----------------------------------- | ---------------------------------------------------------- |
| `__init__.py`                       | Integration setup, service registration, startup/shutdown  |
| `manifest.json`                     | HACS/HA metadata — name, version, domain                   |
| `config_flow.py`                    | Minimal config entry (required by HA to load integration)  |
| `registry.py`                       | In-memory cache — two dicts, CRUD operations               |
| `storage.py`                        | JSON persistence via `homeassistant.helpers.storage.Store` |
| `services.yaml`                     | Service definitions with Fields and Selectors              |
| `strings.json`                      | UI strings for config flow and panel                       |
| `frontend/object-registry-panel.js` | Vanilla custom element — the custom sidebar panel          |

## Data Model (summary — full detail in SPEC.md)

**Two in-memory dicts:**

- Primary: `{ uuid: full_object_dict }` — source of truth
- Lookup: `{ object_id: uuid }` — fast resolution for service calls

**Object structure:**

```python
{
    "uuid": "auto-generated, immutable",
    "object_id": "snake_case, unique, user-defined",
    "name": "Friendly Name, unique",
    "description": "optional string",
    "type": "json",           # always "json" in v1, reserved for future types
    "created": "ISO 8601 UTC datetime",
    "updated": "ISO 8601 UTC datetime",
    "data": {}                # arbitrary JSON — dict, list, nested structures
}
```

> NOTE: `type` field exists for future extensibility. Do not hint at other
> types in docs, README, or examples — it will generate immediate feature requests.

> NOTE: `data_version` is a Store-level concern, not an object field.
> Set it on Store initialization; provide migration callback for future upgrades.

## Service Interface (summary — full detail in SPEC.md)

| Service                      | Input                 | Returns                                  |
| ---------------------------- | --------------------- | ---------------------------------------- |
| `object_registry.list_items` | none                  | List of metadata dicts (no data payload) |
| `object_registry.get_data`   | `object_id` or `uuid` | Single `data` payload dict               |
| `object_registry.get_object` | `object_id` or `uuid` | Full object (metadata + data)            |

## CRUD Rules

- Validate first, then update, then flush to Store — always in this order
- `object_id` and `name` must both be unique across all objects
- `object_id` must match `^[a-z0-9_]+$` (snake_case)
- `uuid` is generated on create, never changes
- Any change to any field updates the `updated` timestamp
- Entire cache is flushed to HA's native custom integration Store pattern on every write (not incremental)

## Canonical Resources

- HA Core: https://github.com/home-assistant/core
- HA Frontend (Lollipop): https://github.com/home-assistant/frontend
- Custom Panels: https://developers.home-assistant.io/docs/frontend/custom-ui/creating-custom-panels
- HA Developer Docs: https://developers.home-assistant.io
- HACS Publish Docs: https://hacs.xyz/docs/publish/start

## Deploy Pipeline

- `./deploy.sh` — sync all files to HAOS via scp, no restart
- `./deploy.sh --restart` — sync + restart HA via API
- `./deploy.sh --files frontend/object-registry-panel.js` — sync specific files
- JS-only changes: deploy + hard refresh browser (`Cmd+Shift+R`), no restart needed
- Python changes: `./deploy.sh --restart`
- Credentials in `deploy.env` (gitignored — never commit)

## Commit Message Format

```
Short imperative subject line

- Bullet describing what changed and why
- Bullet for significant decisions made
```
