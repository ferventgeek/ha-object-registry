"""Constants for the Object Registry integration."""

# Integration domain — must match custom_components folder name
DOMAIN = "object_registry"

# Storage
STORAGE_KEY = "object_registry"
STORAGE_VERSION = 1

# Panel
PANEL_TITLE = "Object Registry"
PANEL_ICON = "mdi:cube-outline"
PANEL_URL = f"/{DOMAIN}_panel"

# WebSocket command types
WS_LIST = f"{DOMAIN}/list"
WS_GET = f"{DOMAIN}/get"
WS_CREATE = f"{DOMAIN}/create"
WS_UPDATE = f"{DOMAIN}/update"
WS_DELETE = f"{DOMAIN}/delete"

# HA event fired after every successful write (panels subscribe to this)
EVENT_REGISTRY_UPDATED = f"{DOMAIN}_updated"

# Validation
OBJECT_ID_PATTERN = r"^[a-z0-9_]+$"

# Default values for new objects shown as placeholders in the panel
DEFAULT_NAME = "New Registry Object"
DEFAULT_OBJECT_ID = "new_registry_object"
DEFAULT_DATA = {"key": "value"}
