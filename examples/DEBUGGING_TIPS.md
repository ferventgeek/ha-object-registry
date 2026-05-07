# Debugging Tips for Object Registry Scripting

## Purpose

This note captures practical Home Assistant scripting patterns for consuming Object Registry data from automations and scripts. I've found a few gotchas when working with templates and assignability in particular, noted below.

This guide is intentionally narrow.

It is not a general Home Assistant scripting guide.
It is not an Object Registry design document.

The goal is to document the YAML patterns that worked when using Object Registry as a read-only mapping store for automations.

## Scope

This applies to scripts and automations that:

- read an Object Registry object
- use its payload as configuration or routing data
- resolve target entities and actions from that data
- execute Home Assistant actions based on the resolved values

Example use cases:

- ISY remote button routing
- fan control mapping
- light scene/action mapping
- device-to-action dispatch maps

## Core Pattern

Keep the Object Registry object as data.

Let the automation do the runtime interpretation.

    event comes in
    automation reads registry data
    automation extracts mapping
    automation resolves target and action
    automation executes action

Object Registry should not know about the automation logic.
The automation should not mutate Object Registry data.

## Tip 1: Use the payload-facing service for consumer automations

For consumer scripts, prefer the service that returns the stored data payload rather than the full registry object.

Current local pattern:

    - action: object_registry.get_data
      data:
        object_id: isy_button_map
      response_variable: button_map

Observed response shape:

    {
      "data": {
        "...": "stored payload here"
      }
    }

So the first extraction step should be:

    - variables:
        mapping: "{{ button_map.get('data', {}) }}"

If the service is later changed to return the payload directly, this can become:

    - variables:
        mapping: "{{ button_map }}"

A defensive version can support both shapes:

    - variables:
        mapping: "{{ button_map.get('data', button_map) }}"

## Tip 2: Split dependent variables across multiple variables steps

Do not assume variables assigned in the same `variables:` block are safely available to later expressions in that same block.

Avoid this:

    - variables:
        mapping: "{{ button_map.get('data', {}) }}"
        remote_config: "{{ mapping.get(source_entity, {}) }}"
        control_config: "{{ remote_config.get('controls', {}).get(control, {}) }}"

Prefer this:

    - variables:
        mapping: "{{ button_map.get('data', {}) }}"

    - variables:
        remote_config: "{{ mapping.get(source_entity, {}) }}"

    - variables:
        control_config: "{{ remote_config.get('controls', {}).get(control, {}) }}"

This makes each intermediate value visible and easier to debug.

## Tip 3: Treat templates as value extractors, not structure constructors

Home Assistant templates are reliable for extracting and transforming values.

They are less predictable when used as inline constructors for whole YAML structures.

Be careful with this:

    data: "{{ control_config.get('data', {}) }}"

Depending on where Home Assistant evaluates it, that may behave like a real mapping or like a string that looks like a mapping.

The safer pattern is:

    - variables:
        action_data: "{{ control_config.get('data', {}) }}"

    - choose:
        - conditions:
            - condition: template
              value_template: "{{ action_data is mapping and action_data | count > 0 }}"
          sequence:
            - action: "{{ mapped_action }}"
              target:
                entity_id: "{{ target_entity }}"
              data: "{{ action_data }}"

        - conditions:
            - condition: template
              value_template: "{{ mapped_action != '' and target_entity != '' }}"
          sequence:
            - action: "{{ mapped_action }}"
              target:
                entity_id: "{{ target_entity }}"

## Tip 4: Omit `data:` when there is no action data

Some Home Assistant actions do not need a data block.

For example:

    light.turn_off

does not need:

    data: {}

When the mapped control does not include data, call the action without a `data:` key.

Good pattern:

    - choose:
        - conditions:
            - condition: template
              value_template: >-
                {{ mapped_action != ''
                   and target_entity != ''
                   and action_data is mapping
                   and action_data | count > 0 }}
          sequence:
            - action: "{{ mapped_action }}"
              target:
                entity_id: "{{ target_entity }}"
              data: "{{ action_data }}"

        - conditions:
            - condition: template
              value_template: >-
                {{ mapped_action != ''
                   and target_entity != '' }}
          sequence:
            - action: "{{ mapped_action }}"
              target:
                entity_id: "{{ target_entity }}"

## Tip 5: Keep mapping objects simple and explicit

A useful Object Registry mapping shape is:

    {
      "sensor.remote_button": {
        "target": "light.example",
        "controls": {
          "DON": {
            "action": "light.turn_on"
          },
          "DOF": {
            "action": "light.turn_off"
          },
          "DFON": {
            "action": "light.turn_on",
            "data": {
              "brightness_pct": 100,
              "transition": 0.1
            }
          }
        }
      }
    }

The automation should resolve:

    source entity
    control code
    target entity
    action name
    optional action data

Do not hide behavior in clever keys.
Use boring names like `target`, `controls`, `action`, and `data`.

## Tip 6: Debug the response shape first

Before debugging routing logic, confirm what the Object Registry service actually returns.

Useful debug script:

    alias: Object Registry Mapping Debug
    description: Debugs one Object Registry mapping lookup
    mode: single

    fields:
      debug_object_id:
        name: Object ID
        example: isy_button_map
        required: false

      debug_source_entity:
        name: Source entity
        example: sensor.playroom_remote_a_playroom_remote_b
        required: false

      debug_control:
        name: Control
        example: DOF
        required: false

    sequence:
      - variables:
          object_id: "{{ debug_object_id | default('isy_button_map', true) }}"
          source_entity: "{{ debug_source_entity | default('sensor.playroom_remote_a_playroom_remote_b', true) }}"
          control: "{{ debug_control | default('DOF', true) }}"

      - action: object_registry.get_data
        data:
          object_id: "{{ object_id }}"
        response_variable: registry_response

      - variables:
          mapping: "{{ registry_response.get('data', registry_response) }}"

      - variables:
          remote_config: "{{ mapping.get(source_entity, {}) }}"

      - variables:
          target_entity: "{{ remote_config.get('target', '') }}"
          control_config: "{{ remote_config.get('controls', {}).get(control, {}) }}"

      - variables:
          mapped_action: "{{ control_config.get('action', '') }}"
          action_data: "{{ control_config.get('data', {}) }}"

      - action: persistent_notification.create
        data:
          title: Object Registry Mapping Debug
          message: |
            object_id: {{ object_id }}
            source_entity: {{ source_entity }}
            control: {{ control }}

            response:
            {{ registry_response | tojson }}

            mapping_keys:
            {{ mapping.keys() | list | tojson }}

            remote_config:
            {{ remote_config | tojson }}

            target_entity:
            {{ target_entity }}

            control_config:
            {{ control_config | tojson }}

            mapped_action:
            {{ mapped_action }}

            action_data:
            {{ action_data | tojson }}

Expected useful debug result:

    target_entity:
    light.office

    mapped_action:
    light.turn_off

    action_data:
    {}

## Tip 7: Use `choose` for expected misses

Routing misses are normal.

Examples:

- event source is not mapped
- control code is not mapped
- source entity is missing the expected label
- Object Registry data is present but not shaped as expected

Use `choose` and `default` rather than allowing the automation to fail obscurely.

Example:

    - choose:
        - conditions:
            - condition: template
              value_template: "{{ mapped_action != '' and target_entity != '' }}"
          sequence:
            - action: "{{ mapped_action }}"
              target:
                entity_id: "{{ target_entity }}"

      default:
        - action: persistent_notification.create
          data:
            title: Router Unhandled
            message: >-
              No mapping found for control {{ control }} from {{ source_entity }}.

## Tip 8: Keep Object Registry data read-only from scripts

Consumer scripts should read Object Registry data and act on it.

They should not edit Object Registry data.

Good:

    automation reads mapping
    automation executes mapped action

Avoid:

    automation rewrites registry objects
    automation mutates mapping state
    automation treats Object Registry as runtime scratch space

Object Registry is durable human-managed configuration, not a runtime state engine.

## Known Good Router Extraction Pattern

This is the extraction pattern that worked reliably:

    - action: object_registry.get_data
      data:
        object_id: isy_button_map
      response_variable: button_map

    - variables:
        mapping: "{{ button_map.get('data', button_map) }}"

    - variables:
        remote_config: "{{ mapping.get(source_entity, {}) }}"

    - variables:
        target_entity: "{{ remote_config.get('target', '') }}"
        control_config: "{{ remote_config.get('controls', {}).get(control, {}) }}"

    - variables:
        mapped_action: "{{ control_config.get('action', '') }}"
        action_data: "{{ control_config.get('data', {}) }}"

## Working Mental Model

Use Object Registry as a durable map.

Use HA YAML as the dispatcher.

Keep each step visible:

    get data
    extract map
    extract remote config
    extract control config
    extract action
    execute action

When something breaks, debug each layer in that order.
