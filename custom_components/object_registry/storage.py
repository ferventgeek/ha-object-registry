"""Storage for the Object Registry integration.

Handles loading and saving the object registry to disk using
Home Assistant's built-in storage helper. Data is stored as JSON
in the HA config directory under .storage/object_registry.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)


class ObjectRegistryStorage:
    """Wraps the HA Store interface for the object registry.

    Responsible for two things only:
    - Loading the saved object list from disk on startup
    - Saving the current object list to disk after every change
    """

    def __init__(self, hass: HomeAssistant) -> None:
        """Set up the Store."""
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)

    async def async_load(self) -> list[dict[str, Any]] | None:
        """Load saved objects from disk.

        Returns a list of object dicts if data exists, or None on first run.
        The caller (registry.py) is responsible for rebuilding the in-memory
        cache from the returned list.
        """
        data = await self._store.async_load()

        if data is None:
            _LOGGER.debug("No existing storage found — starting with empty registry")
            return None

        objects = data.get("objects", [])
        _LOGGER.debug("Loaded %d object(s) from storage", len(objects))
        return objects

    async def async_save(self, objects: dict[str, dict[str, Any]]) -> None:
        """Save the current object registry to disk.

        Accepts the full _objects dict (keyed by uuid) and writes it as a
        list. The entire registry is written every time — no partial saves.
        """
        await self._store.async_save({"objects": list(objects.values())})
        _LOGGER.debug("Saved %d object(s) to storage", len(objects))
