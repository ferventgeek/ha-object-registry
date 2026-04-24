"""The Object Registry integration.

This is the integration entry point. It is responsible for:
  - Loading persisted objects into the in-memory registry on startup
  - Registering the three automation service calls
  - Registering the WebSocket commands used by the sidebar panel
  - Registering the sidebar panel itself
  - Cleaning up on unload
"""

from __future__ import annotations

import logging
import os
from typing import Any

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import ServiceValidationError

from .const import (
    DOMAIN,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
)
from .registry import ObjectRegistry
from .storage import ObjectRegistryStorage
from . import websocket

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Object Registry from a config entry.

    Called by HA when the integration is loaded. Sets up storage,
    loads persisted data, registers services, WebSocket commands,
    and the sidebar panel.
    """
    # Set up storage and registry
    storage = ObjectRegistryStorage(hass)
    registry = ObjectRegistry(storage)
    await registry.async_load()

    # Store registry on hass.data so websocket.py and services can access it
    hass.data[DOMAIN] = registry

    # Register automation service calls
    _register_services(hass)

    # Register WebSocket commands for the panel
    websocket.async_setup(hass)

    # Register the sidebar panel
    await _register_panel(hass)

    _LOGGER.info("Object Registry integration loaded")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the Object Registry integration.

    Called by HA when the user removes the integration or HA shuts down.
    """
    hass.services.async_remove(DOMAIN, "list_items")
    hass.services.async_remove(DOMAIN, "get_item")
    hass.services.async_remove(DOMAIN, "get_object")

    hass.data.pop(DOMAIN, None)

    _LOGGER.info("Object Registry integration unloaded")
    return True


# ------------------------------------------------------------------
# Service registration
# ------------------------------------------------------------------

def _register_services(hass: HomeAssistant) -> None:
    """Register the three automation service calls."""

    async def handle_list_items(call: ServiceCall) -> dict[str, Any]:
        """Return metadata for all objects. No payload included."""
        registry: ObjectRegistry = hass.data[DOMAIN]
        return {"objects": registry.get_all_metadata()}

    async def handle_get_item(call: ServiceCall) -> dict[str, Any]:
        """Return the data payload for a single object."""
        registry: ObjectRegistry = hass.data[DOMAIN]

        object_id = call.data.get("object_id")
        uid = call.data.get("uuid")

        if object_id:
            obj = registry.get_by_object_id(object_id)
            if obj is None:
                raise ServiceValidationError(
                    f"No object found with object_id '{object_id}'"
                )
            return {"data": obj["data"]}

        if uid:
            obj = registry.get_by_uuid(uid)
            if obj is None:
                raise ServiceValidationError(
                    f"No object found with uuid '{uid}'"
                )
            return {"data": obj["data"]}

        raise ServiceValidationError("Must provide either object_id or uuid")

    async def handle_get_object(call: ServiceCall) -> dict[str, Any]:
        """Return the full object including metadata and data payload."""
        registry: ObjectRegistry = hass.data[DOMAIN]

        object_id = call.data.get("object_id")
        uid = call.data.get("uuid")

        if object_id:
            obj = registry.get_by_object_id(object_id)
            if obj is None:
                raise ServiceValidationError(
                    f"No object found with object_id '{object_id}'"
                )
            return obj

        if uid:
            obj = registry.get_by_uuid(uid)
            if obj is None:
                raise ServiceValidationError(
                    f"No object found with uuid '{uid}'"
                )
            return obj

        raise ServiceValidationError("Must provide either object_id or uuid")

    # SupportsResponse.ONLY tells HA these services return data
    # and allows response_variable in automations and scripts
    hass.services.async_register(
        DOMAIN, "list_items", handle_list_items,
        supports_response=SupportsResponse.ONLY
    )
    hass.services.async_register(
        DOMAIN, "get_item", handle_get_item,
        supports_response=SupportsResponse.ONLY
    )
    hass.services.async_register(
        DOMAIN, "get_object", handle_get_object,
        supports_response=SupportsResponse.ONLY
    )


# ------------------------------------------------------------------
# Panel registration
# ------------------------------------------------------------------

async def _register_panel(hass: HomeAssistant) -> None:
    """Register the sidebar panel and its static JS file."""

    # Avoid duplicate registration if setup is called more than once
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

    _LOGGER.debug("Object Registry panel registered")
