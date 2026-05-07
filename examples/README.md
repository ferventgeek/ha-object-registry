# ISY Insteon Remote Router Example

This example shows how to use the Object Registry as a routing table, specifically mapping my ISY Insteon remote button events to Home Assistant light actions via Philips Hue.

I've included both my HA Automation YAML and Object Registry mapping JSON.

---

## The example problem it solves

If you have remotes controlling Hue lights, the traditional approach is to hardcode every button, every light, and every action directly in your automation YAML. That worked until I wanted to change a light scene, add a remote, or worse map custom behaviors for different HA `light`, `fan`, or other objects. At that point I was duplicating long, fragile blocks YAML and hoping I didn't break anything. (Narrator: they did.)

This example moves all of that configuration into the Object Registry. The automation becomes a generic router that never needs to change. The mapping lives in a registry object I can then edit in the HA UI without touching- and breaking- the Automation YAML.

---

## Files in this example

| File                             | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `isy_button_map.json`            | The registry object payload — paste this into the Object Registry UI            |
| `isy_insteon_remote_router.yaml` | The automation — import this into HA                                            |
| `DEBUGGING_TIPS.md`              | Practical scripting patterns and debugging help for registry-backed automations |

---

## How it works

The `isy_button_map` registry object is a routing table structured like this:

```
sensor (remote entity)
  └── target (HA light entity)
  └── controls
        └── ISY control code (DON, DOF, DFON, etc.)
              └── action (HA service to call)
              └── data (optional action parameters)
```

When an ISY button event fires, the automation:

1. Reads the `isy_button_map` object from the registry
2. Looks up the remote that sent the event
3. Finds the control code that was sent
4. Calls the mapped HA action with the mapped parameters

If no mapping is found, a persistent notification tells you exactly what came in — so you can add it to the map rather than wonder why nothing happened.

---

## The remotes in this example

Three remotes control the main bedroom lights — a real-world example of how multiple devices can share a target without duplicating config:

| Remote                              | Target                |
| ----------------------------------- | --------------------- |
| `sensor.main_left_remote_a_b`       | `light.main_bedroom`  |
| `sensor.main_right_remote_a_b`      | `light.main_bedroom`  |
| `sensor.main_bedroom_8btn_switch_c` | `light.main_bedroom`  |
| `sensor.office_remote_b`            | `light.office`        |
| `sensor.guest_remote_a`             | `light.guest_bedside` |

Each remote gets its own full set of control mappings — so they can diverge later without touching the automation.

---

## Control codes

This example uses ISY Insteon control codes:

| Code     | Meaning                         |
| -------- | ------------------------------- |
| `DON`    | Button pressed on               |
| `DOF`    | Button pressed off              |
| `DFON`   | Double-tap on (full brightness) |
| `DFOF`   | Double-tap off (warm dim)       |
| `FDUP`   | Hold — start raising            |
| `FDDOWN` | Hold — start lowering           |
| `FDSTOP` | Release — stop ramping          |

---

## Smooth dimming via hue_dimmer

The raise, lower, and stop actions in this example use the excellent **[Philips Hue Smooth Dimmer](https://github.com/jasonmx/philips-hue-smooth-dimmer)** integration by [@jasonmx](https://github.com/jasonmx). The Smooth Dimmer integration maps directly to Hue's native raise/lower/stop commands, which means buttery smooth dimming with no timer loops in your YAML. Highly recommended if you're using Hue lights.

It's also an example of how you can combine this approach with other integrations.

---

## Getting started

1. Install the Object Registry integration (see [README.md](../README.md))
2. Open the Object Registry panel in the HA sidebar
3. Create a new object with:
   - **Name:** `ISY Button Map`
   - **Object ID:** `isy_button_map`
4. Paste the contents of `isy_button_map.json` into the data editor
5. Save
6. Import `isy_insteon_remote_router.yaml` as a new automation in HA
7. Adjust the sensor and light entity IDs to match your setup

---

## Adapting this example

The automation itself is generic by design. It doesn't know anything about ISY, Insteon, or lights specifically. To adapt it:

- **Different remotes or lights** — edit the registry object in the UI, no YAML changes needed
- **Different control codes** — add or remove keys in the `controls` block for each remote
- **Different action parameters** — update the `data` block for any control code
- **Different device types** — the same pattern works for fans, switches, or anything else HA can control. Just create a new registry object with the same shape.

For deeper scripting patterns and debugging help, see [DEBUGGING_TIPS.md](./DEBUGGING_TIPS.md).
