"""Config flow for the Object Registry integration.

This is a minimal config flow — it exists because Home Assistant requires
a config entry to load a modern integration. There is nothing to configure;
all management is done via the sidebar panel.

The user sees a single confirmation step in Settings → Integrations →
Add Integration → Object Registry. One click, done.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class ObjectRegistryConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the one-step setup flow for Object Registry.

    No user input is needed. The flow creates a single config entry
    that tells HA to load the integration.
    """

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step shown to the user.

        If the integration is already set up, block a second install.
        Otherwise create the config entry immediately.
        """
        # Prevent multiple instances
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Object Registry", data={})

        # Show a confirmation form with no fields
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )
