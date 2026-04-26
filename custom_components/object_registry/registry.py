"""In-memory object registry for the Object Registry integration.

Manages two dicts:
  _objects: { uuid: full_object_dict }  — source of truth
  _index:   { object_id: uuid }         — fast lookup for service calls

All CRUD operations follow the same sequence without exception:
  1. Validate inputs
  2. Update _objects
  3. Update _index
  4. Flush to storage
"""

from __future__ import annotations

import logging
import re
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Any

from .const import DOMAIN, EVENT_REGISTRY_UPDATED, OBJECT_ID_PATTERN
from .storage import ObjectRegistryStorage

_LOGGER = logging.getLogger(__name__)


class ObjectRegistry:
    """Manages the in-memory object registry and coordinates with storage."""

    def __init__(self, storage: ObjectRegistryStorage) -> None:
        """Set up the registry with an empty cache."""
        self._storage = storage
        self._objects: dict[str, dict[str, Any]] = {}
        self._index: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------

    async def async_load(self) -> None:
        """Load persisted objects from storage into memory.

        Called once during integration setup. Rebuilds both _objects and
        _index from the stored list.
        """
        objects = await self._storage.async_load()

        if objects is None:
            _LOGGER.debug("Registry starting empty")
            return

        for obj in objects:
            uid = obj["uuid"]
            self._objects[uid] = obj
            self._index[obj["object_id"]] = uid

        _LOGGER.debug("Registry loaded %d object(s)", len(self._objects))

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    def get_all_metadata(self) -> list[dict[str, Any]]:
        """Return metadata for all objects, without the data payload.

        Used by the list_items service and the panel list view.
        """
        return [_strip_payload(obj) for obj in self._objects.values()]

    def get_by_object_id(self, object_id: str) -> dict[str, Any] | None:
        """Return the full object for a given object_id, or None if not found."""
        uid = self._index.get(object_id)
        if uid is None:
            return None
        return self._objects.get(uid)

    def get_by_uuid(self, uid: str) -> dict[str, Any] | None:
        """Return the full object for a given uuid, or None if not found."""
        return self._objects.get(uid)

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    async def async_create(
        self,
        hass: Any,
        object_id: str,
        name: str,
        description: str,
        data: Any,
    ) -> dict[str, Any]:
        """Create a new object and persist it.

        Raises ValueError with a descriptive message if validation fails.
        Returns the full new object dict on success.
        """
        _validate_object_id_format(object_id)
        _validate_object_id_unique(object_id, self._index)
        _validate_name_unique(name, self._objects)

        now = _utc_now()
        uid = str(uuid_lib.uuid4())

        obj = {
            "uuid": uid,
            "object_id": object_id,
            "name": name,
            "description": description,
            "type": "json",
            "created": now,
            "updated": now,
            "data": data,
        }

        self._objects[uid] = obj
        self._index[object_id] = uid

        await self._storage.async_save(self._objects)
        hass.bus.async_fire(EVENT_REGISTRY_UPDATED, {"uuid": uid, "action": "create"})

        _LOGGER.debug("Created object: %s (%s)", name, object_id)
        return obj

    async def async_update(
        self,
        hass: Any,
        uid: str,
        object_id: str,
        name: str,
        description: str,
        data: Any,
    ) -> dict[str, Any]:
        """Update an existing object and persist it.

        Raises ValueError with a descriptive message if validation fails.
        Returns the updated full object dict on success.
        """
        existing = self._objects.get(uid)
        if existing is None:
            raise ValueError(f"No object found with uuid '{uid}'")

        # Only validate uniqueness if the value is actually changing
        if object_id != existing["object_id"]:
            _validate_object_id_format(object_id)
            _validate_object_id_unique(object_id, self._index)

        if name != existing["name"]:
            _validate_name_unique(name, self._objects, exclude_uuid=uid)

        # Update _index if object_id changed
        if object_id != existing["object_id"]:
            del self._index[existing["object_id"]]
            self._index[object_id] = uid

        existing.update({
            "object_id": object_id,
            "name": name,
            "description": description,
            "data": data,
            "updated": _utc_now(),
        })

        await self._storage.async_save(self._objects)
        hass.bus.async_fire(EVENT_REGISTRY_UPDATED, {"uuid": uid, "action": "update"})

        _LOGGER.debug("Updated object: %s (%s)", name, object_id)
        return existing

    async def async_delete(self, hass: Any, uid: str) -> None:
        """Delete an object and persist the change.

        Raises ValueError if the uuid is not found.
        """
        obj = self._objects.get(uid)
        if obj is None:
            raise ValueError(f"No object found with uuid '{uid}'")

        del self._index[obj["object_id"]]
        del self._objects[uid]

        await self._storage.async_save(self._objects)
        hass.bus.async_fire(EVENT_REGISTRY_UPDATED, {"uuid": uid, "action": "delete"})

        _LOGGER.debug("Deleted object: %s (%s)", obj["name"], obj["object_id"])


# ------------------------------------------------------------------
# Private helpers
# ------------------------------------------------------------------

def _validate_object_id_format(object_id: str) -> None:
    """Raise ValueError if object_id does not match snake_case pattern."""
    if not re.match(OBJECT_ID_PATTERN, object_id):
        raise ValueError(
            f"object_id '{object_id}' must use only lowercase letters, "
            "numbers, and underscores"
        )


def _validate_object_id_unique(object_id: str, index: dict[str, str]) -> None:
    """Raise ValueError if object_id is already in use."""
    if object_id in index:
        raise ValueError(f"object_id '{object_id}' is already in use")


def _validate_name_unique(
    name: str,
    objects: dict[str, dict],
    exclude_uuid: str | None = None,
) -> None:
    """Raise ValueError if name is already in use by another object."""
    for uid, obj in objects.items():
        if uid == exclude_uuid:
            continue
        if obj["name"].lower() == name.lower():
            raise ValueError(f"name '{name}' is already in use")


def _strip_payload(obj: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the object dict without the data payload."""
    return {k: v for k, v in obj.items() if k != "data"}


def _utc_now() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()
