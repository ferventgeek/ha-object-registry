"""WebSocket API for the Object Registry integration.

These handlers are called by the sidebar panel (object-registry-panel.js)
to read and write registry objects. They are separate from the automation
service interface (services.yaml / __init__.py).

Each handler follows the same pattern:
  1. Extract input from the message
  2. Call the appropriate registry method
  3. Send result or error back to the panel
"""

from __future__ import annotations

import json
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import (
    DOMAIN,
    WS_CREATE,
    WS_DELETE,
    WS_GET,
    WS_LIST,
    WS_UPDATE,
)
from .registry import ObjectRegistry

_LOGGER = logging.getLogger(__name__)


@callback
def async_setup(hass: HomeAssistant) -> None:
    """Register all WebSocket command handlers.

    Called from __init__.py during integration setup.
    """
    websocket_api.async_register_command(hass, websocket_list)
    websocket_api.async_register_command(hass, websocket_get)
    websocket_api.async_register_command(hass, websocket_create)
    websocket_api.async_register_command(hass, websocket_update)
    websocket_api.async_register_command(hass, websocket_delete)


# ------------------------------------------------------------------
# List — return metadata for all objects (no payload)
# ------------------------------------------------------------------

@websocket_api.websocket_command({"type": WS_LIST})
@websocket_api.async_response
async def websocket_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return metadata for all objects in the registry."""
    registry: ObjectRegistry = hass.data[DOMAIN]
    connection.send_result(msg["id"], registry.get_all_metadata())


# ------------------------------------------------------------------
# Get — return one full object by object_id or uuid
# ------------------------------------------------------------------

@websocket_api.websocket_command(
    {
        "type": WS_GET,
        vol.Optional("object_id"): str,
        vol.Optional("uuid"): str,
    }
)
@websocket_api.async_response
async def websocket_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the full object for a given object_id or uuid."""
    registry: ObjectRegistry = hass.data[DOMAIN]

    object_id = msg.get("object_id")
    uid = msg.get("uuid")

    if object_id:
        obj = registry.get_by_object_id(object_id)
        if obj is None:
            connection.send_error(
                msg["id"], "not_found", f"No object found with object_id '{object_id}'"
            )
            return
    elif uid:
        obj = registry.get_by_uuid(uid)
        if obj is None:
            connection.send_error(
                msg["id"], "not_found", f"No object found with uuid '{uid}'"
            )
            return
    else:
        connection.send_error(
            msg["id"], "invalid_input", "Must provide either object_id or uuid"
        )
        return

    connection.send_result(msg["id"], obj)


# ------------------------------------------------------------------
# Create — add a new object to the registry
# ------------------------------------------------------------------

@websocket_api.websocket_command(
    {
        "type": WS_CREATE,
        vol.Required("object_id"): str,
        vol.Required("name"): str,
        vol.Optional("description", default=""): str,
        vol.Required("data"): str,  # JSON string from the panel editor
    }
)
@websocket_api.async_response
async def websocket_create(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Create a new object in the registry."""
    registry: ObjectRegistry = hass.data[DOMAIN]

    # Parse and validate the JSON data string from the panel editor
    data = _parse_json(msg["data"])
    if data is None:
        connection.send_error(
            msg["id"], "invalid_json", "data is not valid JSON"
        )
        return

    try:
        obj = await registry.async_create(
            hass=hass,
            object_id=msg["object_id"],
            name=msg["name"],
            description=msg["description"],
            data=data,
        )
    except ValueError as err:
        connection.send_error(msg["id"], "validation_error", str(err))
        return

    connection.send_result(msg["id"], obj)


# ------------------------------------------------------------------
# Update — modify an existing object
# ------------------------------------------------------------------

@websocket_api.websocket_command(
    {
        "type": WS_UPDATE,
        vol.Required("uuid"): str,
        vol.Required("object_id"): str,
        vol.Required("name"): str,
        vol.Optional("description", default=""): str,
        vol.Required("data"): str,  # JSON string from the panel editor
    }
)
@websocket_api.async_response
async def websocket_update(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update an existing object in the registry."""
    registry: ObjectRegistry = hass.data[DOMAIN]

    # Parse and validate the JSON data string from the panel editor
    data = _parse_json(msg["data"])
    if data is None:
        connection.send_error(
            msg["id"], "invalid_json", "data is not valid JSON"
        )
        return

    try:
        obj = await registry.async_update(
            hass=hass,
            uid=msg["uuid"],
            object_id=msg["object_id"],
            name=msg["name"],
            description=msg["description"],
            data=data,
        )
    except ValueError as err:
        connection.send_error(msg["id"], "validation_error", str(err))
        return

    connection.send_result(msg["id"], obj)


# ------------------------------------------------------------------
# Delete — remove an object from the registry
# ------------------------------------------------------------------

@websocket_api.websocket_command(
    {
        "type": WS_DELETE,
        vol.Required("uuid"): str,
    }
)
@websocket_api.async_response
async def websocket_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Delete an object from the registry."""
    registry: ObjectRegistry = hass.data[DOMAIN]

    try:
        await registry.async_delete(hass=hass, uid=msg["uuid"])
    except ValueError as err:
        connection.send_error(msg["id"], "validation_error", str(err))
        return

    connection.send_result(msg["id"], {"success": True})


# ------------------------------------------------------------------
# Private helpers
# ------------------------------------------------------------------

def _parse_json(value: str) -> Any | None:
    """Parse a JSON string and return the result, or None if invalid."""
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None
