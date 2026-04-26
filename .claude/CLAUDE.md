# CLAUDE.md — Object Registry for Home Assistant

## What This Project Is

`object_registry` is a Home Assistant custom integration that provides a named,
in-memory object registry accessible from HA automations and scripts via service
calls. Objects are JSON structures (Python dicts in memory) persisted via HA's
native `homeassistant.helpers.storage.Store` interface. Managed via a custom
sidebar panel built with Lit/HA web components. Distributed via HACS and GitHub.

## Current Status

> **Update this section at the start of every working session.**

Phase: **v1 feature complete — pre-HACS / pre-public**
Working on: Bug fixing, UI polish, disappearing panel investigation.
Next: HACS prep (`hacs.json`, CI workflow), README, first tagged release, go public.

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
   Do not add flexibility that invites "here's my 200-line automation" issues.
4. **HA conventions.** Follow HA core patterns throughout — storage, config flow,
   service registration, async, Lit web components, HA design tokens.
5. **No backwards compatibility.** Targets HA 2026.4+ only.
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
| `object_registry.get_item`   | `object_id` or `uuid` | Single `data` payload dict               |
| `object_registry.get_object` | `object_id` or `uuid` | Full object (metadata + data)            |

## CRUD Rules

- Validate first, then update, then flush to Store — always in this order
- `object_id` and `name` must both be unique across all objects
- `object_id` must match `^[a-z0-9_]+$` (snake_case)
- `uuid` is generated on create, never changes, never exposed in service calls
- Any change to any field updates the `updated` timestamp
- Entire cache is flushed to Store on every write (not incremental)

## Canonical Resources

- HA Core: https://github.com/home-assistant/core
- HA Frontend (Lollipop): https://github.com/home-assistant/frontend
- Custom Panels: https://developers.home-assistant.io/docs/frontend/custom-ui/creating-custom-panels
- HA Developer Docs: https://developers.home-assistant.io
- HACS Publish Docs: https://hacs.xyz/docs/publish/start

## Commit Message Format

```
Short imperative subject line

- Bullet describing what changed and why
- Bullet for significant decisions made
```
