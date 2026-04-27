# Object Registry for Home Assistant

> ⚠️ **Status: Feature complete but not yet recommended for production use.**
> The integration is fully functional, with CRUD, real-time updates, concurrent edit
> detection, and validation, but there is an outstanding issue with the custom panel
> going blank after Chrome throttles background tabs. I am seeking guidance from
> the HA frontend developer community before publishing to HACS.

---

![Object Registry list view](docs/screenshots/ha-object-registry-list-view.png)

---

## What It Does

Home Assistant has transformed what I can do with automation in my complex
environment with a lot of legacy automation tech. But what I could not find was an easy way to create and manage
configuration-style structured data. Think mapping tables, lookup references, and device relationships,
without working directly with the file system or embedding it
in automation YAML. (Example below) I was specifically looking for something
GUI-driven, and cached for performance. This was my answer and hopefully isn't
a duplicate of something better that already exists that I missed.

**Object Registry** provides a named, in-memory JSON object store accessible from
any automation or script via service calls. Define your mapping or config data once, reuse it anywhere.

**A concrete example:** An ISY/Eisy controller manages legacy Insteon and Z-Wave
devices pretty well, especially Insteon native table links. However, wiring up five different ISY remote button
events to the Hue light actions specific to different devices
requires a mapping layer. Without a registry, that mapping is hardcoded across
automations and prone to breakage. With Object Registry, a single service call retrieves a
mapping object making automations short, readable, and more reusable.

### Capabilities

- **In-memory object store** — named JSON objects accessible from automations and
  scripts via `object_registry.get_item`, `get_object`, and `list_items`
- **Native HA panel** — full management UI in the sidebar, no file editing required
- **Real-time live updates** — the panel list updates instantly when any object
  changes, even from another browser window
- **Concurrent edit detection** — amber warning banner appears if another user
  saves a change to the object you are editing
- **Validation** — snake_case object IDs, unique names (case-insensitive),
  valid JSON enforced on save
- **Rename safety** — renaming an object_id triggers a confirmation warning that
  existing automations may break
- **Persistent storage** — objects survive HA restarts via HA's native Store
  interface
- **HACS-ready** — structured for easy community installation once stable

---

![Object Registry editor view](docs/screenshots/ha-object-registry-edit-view.png)

---

## Installation

> Not yet available in HACS default store. Manual installation only for now.

### Manual via HACS (custom repository)

1. In HACS → Integrations → ⋮ → Custom repositories
2. Add `https://github.com/ferventgeek/ha-object-registry` as an Integration
3. Install **Object Registry**
4. Restart Home Assistant
5. Go to Settings → Integrations → Add Integration → **Object Registry**

### Manual

1. Copy `custom_components/object_registry/` into your HA `config/custom_components/` directory
2. Restart Home Assistant
3. Go to Settings → Integrations → Add Integration → **Object Registry**

---

## Usage

Once installed, **Object Registry** appears in the sidebar. Use the panel to
create and manage objects.

### Service calls

Use objects in automations and scripts via three service calls:

**Get just the data payload** — returns only the JSON you stored, ready to use
directly in templates. This is what most automations need:

```yaml
action: object_registry.get_item
data:
  object_id: isy_button_map
response_variable: result
# result.data contains your JSON payload
```

**Get the full object including metadata** — returns the payload plus `uuid`,
`name`, `description`, `created`, `updated`, and `type`:

```yaml
action: object_registry.get_object
data:
  object_id: isy_button_map
response_variable: result
# result.data contains your JSON payload
# result.name, result.updated, etc. also available
```

**List all objects (metadata only, no payload):**

```yaml
action: object_registry.list_items
response_variable: result
```

See [`examples/basic_usage.yaml`](examples/basic_usage.yaml) for a complete
automation example. More examples coming based on community feedback.

---

## Known Issues

### Panel goes blank after background tab throttling

After approximately 5 minutes in a background browser tab, Chrome throttles
JavaScript execution. HA's `partial-panel-resolver` removes the custom panel
element from the DOM during this period. On tab return, the panel stays blank
until the user clicks another sidebar item and returns.

I've tried everything I can think of, but JS framework messaging is a nemesis for me second only to CSS.
I am making it public early and seeking input from the HA frontend developer community
on the correct lifecycle hook for this situation. I'm sure others have worked around the issue of blanking
when the browser throttles background updates when the panel is not in the focused tab.

**Workaround:** Click any other sidebar item and back to Object Registry again, or refresh the page.
The panel reloads immediately.

---

## Requirements

- Home Assistant 2026.4 or later
- No external dependencies

---

## Development

This project was built using a design-doc-first methodology with AI assistance.
See [`docs/`](docs/) for full architecture, design philosophy, and specification
documents.

The code is intentionally written for readability. I've tried to keep the code
understandable by casual coders like me without external references. No build
step, no external dependencies, no advanced patterns.

---

## Gratitude

I am incredibly grateful to the Home Assistant developer community. It's the quality
of their documentation, open-source frontend code, and the generosity of
developers sharing patterns and answering questions made this project possible.
This is my first HA integration and I could not have gotten this far without the
foundation the community has built. Thank you so much!

---

## License

MIT — see [LICENSE](LICENSE)

![Object Registry integration view](docs/screenshots/ha-object-registry-integration-view.png)
