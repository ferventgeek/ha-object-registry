/**
 * Object Registry Panel
 *
 * A custom sidebar panel for managing the Object Registry.
 * Built as a plain custom element — no build step required.
 *
 * Uses HA's existing web components (ha-code-editor, ha-dialog)
 * and CSS custom properties for native look and feel.
 *
 * Communicates with the backend exclusively via WebSocket (this._hass.callWS).
 *
 * Two views:
 *   LIST VIEW  — sortable table of all objects, collapsed accordion rows
 *   EDIT VIEW  — split panel: list (top) + editor (bottom)
 *
 * Panel lifecycle:
 *   - constructor: reuses existing shadow root if HA created one via DSD
 *   - set hass: primary entry point, triggers load or render as needed
 *   - connectedCallback: renders current state
 *   - disconnectedCallback: cleans up WebSocket subscription
 */

class ObjectRegistryPanel extends HTMLElement {
  constructor() {
    super();
    // If HA serialized our shadow DOM during tab backgrounding (Declarative
    // Shadow DOM), the shadow root already exists — reuse it instead of
    // calling attachShadow() again which would throw or replace it.
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    // HA injects these properties
    this._hass = null;
    this._panel = null;

    // Panel state
    this._objects = [];         // list of full object dicts from backend
    this._editingUuid = null;   // uuid of object currently open in editor (null = none)
    this._isAdding = false;     // true when the editor is open for a new object

    // Editor form state
    this._form = _emptyForm();
    this._originalForm = null;  // snapshot of form when editor was opened (for dirty check)

    // Banner state
    this._errorMessage = null;
    this._warnMessage = null;

    // Sort state
    this._sortBy = "updated";   // "name" | "object_id" | "updated"
    this._sortAsc = false;

    // Bound event listener for concurrent edit detection
    this._onRegistryUpdated = this._onRegistryUpdated.bind(this);
  }

  // HA sets this property with the hass object whenever it changes.
  set hass(hass) {
    console.log("[OR] set hass called", !!hass, !!this.shadowRoot.querySelector('.panel'));
    this._hass = hass;

    if (!hass) {
      // hass temporarily unavailable — preserve DOM, do not wipe
      return;
    }

    if (!this._loaded || !this.shadowRoot.querySelector(".panel")) {
      // First load or DOM was wiped (e.g. DSD restore after tab switch)
      this._loaded = true;
      this._load();
      return;
    }

    // hass updated (HA state heartbeat) — store the new hass object so
    // subsequent callWS() calls use a fresh connection, but do NOT re-render.
    // List view stays current via object_registry_updated event subscription.
    // Editor must never be re-rendered here — it would destroy focus and
    // wipe unsaved input on every HA entity state change in the system.
  }

  // HA sets this with panel config
  set panel(panel) {
    this._panel = panel;
  }

  connectedCallback() {
    this._render();
  }

  disconnectedCallback() {
    // Clean up WebSocket event subscription if active
    if (this._unsubscribeEvents) {
      this._unsubscribeEvents();
      this._unsubscribeEvents = null;
    }
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  async _load() {
    try {
      const result = await this._hass.callWS({ type: "object_registry/list" });
      this._objects = result || [];

      // Do not re-render while the editor is open — that would wipe the editor
      // DOM, destroy focus, and discard unsaved input. The list behind the
      // editor will be current when the user closes it and _render() runs then.
      const isEditing = this._editingUuid !== null || this._isAdding;
      if (isEditing) return;

      this._render();

      // Subscribe to backend registry update events via HA WebSocket.
      // This replaces window.addEventListener which cannot receive HA bus events.
      // Called after every load to handle reconnection; guard prevents duplicates.
      // Subscribe to registry update events. Wrap in its own try/catch so
      // a dead subscription (e.g. after tab throttling) doesn't crash _load.
      if (!this._unsubscribeEvents && this._hass.connection) {
        try {
          this._unsubscribeEvents = await this._hass.connection.subscribeEvents(
            (event) => this._onRegistryUpdated(event),
            "object_registry_updated"
          );
        } catch (subErr) {
          // Subscription failed — clear so next load will retry
          console.debug("Object Registry: subscription failed, will retry", subErr.message);
          this._unsubscribeEvents = null;
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // HA navigation transition interrupted — _loaded stays false so
        // the next hass assignment will retry _load() automatically.
        this._loaded = false;
        return;
      }
      console.error("Object Registry: failed to load objects", err);
    }
  }

  // Called when the backend fires an object_registry_updated event.
  // Receives HA bus event format: { event_type, data: { uuid, action } }
  _onRegistryUpdated(event) {
    const { uuid, action } = event.data || {};
    const isEditing = this._editingUuid !== null || this._isAdding;

    if (isEditing) {
      // If the object being edited was changed externally, show warning banner
      // in-place — targeted DOM patch only, no full re-render that would
      // destroy focus or wipe unsaved input.
      if (this._editingUuid && uuid === this._editingUuid && action !== "delete") {
        this._warnMessage =
          "This object was modified in another window. Saving will overwrite " +
          "those changes. Use Restore to load the current version.";
        this._updateBanner();
      }
      // Silently refresh this._objects so the list is current when editor closes.
      // _load() will skip _render() because isEditing is true (guard in _load).
      this._load();
      return;
    }

    // Not editing — reload and re-render the list normally.
    this._load();
  }

  // Update the error/warning banners in-place without re-rendering the editor.
  // Finds the existing ha-alert elements in the shadow DOM and updates them
  // directly, preserving focus and unsaved input in all other fields.
  _updateBanner() {
    const root = this.shadowRoot;
    if (!root) return;

    // Remove any existing banners
    root.querySelectorAll(".banner").forEach(el => el.remove());

    // Insert new banners before the code editor wrapper
    const mount = root.getElementById("code-editor-mount");
    if (!mount) return;

    if (this._errorMessage) {
      const alert = document.createElement("ha-alert");
      alert.setAttribute("alert-type", "error");
      alert.className = "banner";
      alert.textContent = this._errorMessage;
      mount.before(alert);
    }

    if (this._warnMessage) {
      const alert = document.createElement("ha-alert");
      alert.setAttribute("alert-type", "warning");
      alert.className = "banner";
      alert.textContent = this._warnMessage;
      mount.before(alert);
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  _render() {
    if (!this._hass) return;
    const isEditing = this._editingUuid !== null || this._isAdding;
    this.shadowRoot.innerHTML = `
      <style>${_styles()}</style>
      <div class="panel">
        <div class="panel-header">
          <h1>Object Registry Catalog</h1>
        </div>
        ${isEditing ? this._renderSplitView() : this._renderListView()}
      </div>
      ${this._renderDeleteDialog()}
      ${this._renderRenameDialog()}
      ${this._renderDiscardDialog()}
    `;
    this._attachEventListeners();

    // Create ha-code-editor programmatically and append to mount point.
    // Setting value before appendChild means the element has its value
    // before Lit's first render, avoiding async timing issues.
    if (isEditing) {
      const mount = this.shadowRoot.getElementById("code-editor-mount");
      if (mount) {
        const editor = document.createElement("ha-code-editor");
        editor.id = "field-data";
        editor.mode = "jinja2";
        editor.style.height = "100%";
        editor.style.display = "block";
        editor.value = this._form.data || "";
        editor.addEventListener("value-changed", (e) => {
          this._form.data = e.detail.value;
          this._updateSaveButton();
        });
        mount.appendChild(editor);

        // Inject CSS into ha-code-editor's Shadow DOM to force CM6 to fill
        // container height and scroll. This cannot be done from outside Shadow DOM.
        // Tribal knowledge: target .cm-editor and .cm-scroller (CM6 class names).
        setTimeout(() => {
          if (editor.shadowRoot) {
            const style = document.createElement("style");
            style.textContent = `
              :host, .editor, .cm-editor {
                height: 100% !important;
                display: flex !important;
                flex-direction: column !important;
              }
              .cm-scroller {
                flex: 1 !important;
                overflow: auto !important;
              }
            `;
            editor.shadowRoot.appendChild(style);
          }
        }, 0);
      }
    }
  }

  _renderListView() {
    // FIX 3: FAB only shown in list view, not during edit/add
    return `
      <div class="list-view">
        ${this._renderTableHeader()}
        <div class="object-list">
          ${this._sortedObjects().map(obj => this._renderCollapsedRow(obj)).join("")}
          ${this._objects.length === 0 ? this._renderEmptyState() : ""}
        </div>
      </div>
      <button class="fab" id="btn-add" title="Add item">
        <span class="fab-icon">+</span> Add item
      </button>
    `;
  }

  _renderSplitView() {
    const editingObj = this._editingUuid
      ? this._objects.find(o => o.uuid === this._editingUuid)
      : null;
    const otherObjects = this._sortedObjects().filter(
      o => o.uuid !== this._editingUuid
    );

    // FIX 3: No FAB in split view — Add item not available during edit
    return `
      <div class="split-view">
        <div class="split-top">
          ${this._renderTableHeader()}
          <div class="object-list">
            ${otherObjects.map(obj => this._renderCollapsedRow(obj)).join("")}
            ${otherObjects.length === 0 ? '<div class="empty-split">No other objects</div>' : ""}
          </div>
        </div>
        <div class="split-bottom">
          ${this._renderEditor(editingObj)}
        </div>
      </div>
    `;
  }

  _renderTableHeader() {
    // FIX 4: Show sort direction indicator on active column
    const indicator = (col) => {
      if (this._sortBy !== col) return "";
      return this._sortAsc ? " ▲" : " ▼";
    };

    return `
      <div class="table-header">
        <div class="col-icon"></div>
        <div class="col-object">
          <span class="sortable ${this._sortBy === "name" ? "sorted" : ""}"
                data-sort="name">Object${indicator("name")}</span>
        </div>
        <div class="col-id">
          <span class="sortable ${this._sortBy === "object_id" ? "sorted" : ""}"
                data-sort="object_id">Object ID${indicator("object_id")}</span>
        </div>
        <div class="col-updated">
          <span class="sortable ${this._sortBy === "updated" ? "sorted" : ""}"
                data-sort="updated">Last update${indicator("updated")}</span>
        </div>
        <div class="col-type">Type</div>
        <div class="col-chevron"></div>
      </div>
    `;
  }

  _renderCollapsedRow(obj) {
    return `
      <div class="object-row" data-uuid="${obj.uuid}">
        <div class="col-icon">
          <div class="obj-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </div>
        </div>
        <div class="col-object">
          <div class="obj-name">${_escape(obj.name)}</div>
          <div class="obj-desc">${_escape(obj.description || "")}</div>
        </div>
        <div class="col-id obj-id">${_escape(obj.object_id)}</div>
        <div class="col-updated obj-updated">${_relativeTime(obj.updated)}</div>
        <div class="col-type obj-type">${_escape(obj.type.toUpperCase())}</div>
        <div class="col-chevron">
          <svg class="chevron-icon" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"
               style="width:20px;height:20px;transform:rotate(90deg);color:var(--secondary-text-color);"
               fill="currentColor">
            <path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/>
          </svg>
        </div>
      </div>
    `;
  }

  _renderEmptyState() {
    return `
      <div class="empty-state">
        No objects yet. Click '+ Add item' to create one.
      </div>
    `;
  }

  _renderEditor(obj) {
    const isAdd = this._isAdding;
    const form = this._form;
    const isDirty = this._isDirty();

    // Note: ha-code-editor value is NOT set here — it is set after render
    // via DOM property in _render(). See FIX 1 comment there.
    return `
      <div class="editor">
        <div class="editor-header">
          <div class="col-icon">
            <div class="obj-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
          </div>
          <div class="editor-fields">
            <div class="editor-row-top">
              <div class="field-name">
                <label class="field-label">name *</label>
                <input class="ha-input" id="field-name" type="text"
                       value="${_escape(form.name)}"
                       placeholder="New Registry Object" />
              </div>
              <div class="field-object-id">
                <label class="field-label">object_id *</label>
                <input class="ha-input" id="field-object-id" type="text"
                       value="${_escape(form.object_id)}"
                       placeholder="new_registry_object" />
              </div>
              <div class="editor-type-badge">
                ${isAdd ? "JSON" : _escape((obj?.type || "json").toUpperCase())}
              </div>
              <div></div>
            </div>
            <div class="editor-row-desc">
              <div style="display:flex;flex-direction:column;flex:1;">
                <label class="field-label">description</label>
                <input class="ha-input ha-input-full" id="field-description" type="text"
                       value="${_escape(form.description)}"
                       placeholder="Optional description" />
              </div>
            </div>
            ${!isAdd && obj ? `
            <div class="editor-timestamps">
              <span>Updated: ${_formatDateTime(obj.updated)}&nbsp;&nbsp;Created: ${_formatDateTime(obj.created)}</span>
            </div>
            ` : ""}
          </div>
        </div>

        ${this._errorMessage ? `
        <ha-alert alert-type="error" class="banner">${_escape(this._errorMessage)}</ha-alert>
        ` : ""}

        ${this._warnMessage ? `
        <ha-alert alert-type="warning" class="banner">${_escape(this._warnMessage)}</ha-alert>
        ` : ""}

        <div class="code-editor-wrapper" id="code-editor-mount">
        </div>

        <div class="editor-buttons">
          <div class="btn-left">
            ${!isAdd ? `
            <button class="btn-delete" id="btn-delete">Delete object</button>
            ` : ""}
          </div>
          <div class="btn-right">
            ${!isAdd ? `
            <button class="btn-text" id="btn-restore">Restore</button>
            ` : ""}
            <button class="btn-secondary" id="btn-cancel">Cancel</button>
            <button class="btn-primary" id="btn-save" ${isDirty ? "" : "disabled"}>
              <svg viewBox="0 0 24 24" width="16" height="16" style="fill:white;flex-shrink:0;">
                <path d="M17 3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V7L17 3M19 19H5V5H16.17L19 7.83V19M12 12C10.34 12 9 13.34 9 15S10.34 18 12 18 15 16.66 15 15 13.66 12 12 12M6 6H15V10H6V6Z"/>
              </svg>
              Save
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderDeleteDialog() {
    const obj = this._editingUuid
      ? this._objects.find(o => o.uuid === this._editingUuid)
      : null;
    return `
      <dialog id="dialog-delete">
        <div class="dialog-content">
          <h2>Delete ${obj ? _escape(obj.name) : "object"}?</h2>
          <p>This cannot be undone.</p>
          <div class="dialog-buttons">
            <button class="btn-dialog-cancel" id="dialog-delete-cancel">Cancel</button>
            <button class="btn-danger" id="dialog-delete-confirm">Delete</button>
          </div>
        </div>
      </dialog>
    `;
  }

  _renderRenameDialog() {
    return `
      <dialog id="dialog-rename">
        <div class="dialog-content">
          <h2>Rename object ID?</h2>
          <p>
            Changing the object_id from
            <strong id="rename-old-id"></strong> to
            <strong id="rename-new-id"></strong>
            may break Automations, Scripts, or other integrations that
            reference the old object_id.
          </p>
          <div class="dialog-buttons">
            <button class="btn-dialog-cancel" id="dialog-rename-cancel">Cancel</button>
            <button class="btn-primary" id="dialog-rename-confirm">
              Confirm rename and save
            </button>
          </div>
        </div>
      </dialog>
    `;
  }

  _renderDiscardDialog() {
    return `
      <dialog id="dialog-discard">
        <div class="dialog-content">
          <h2>Unsaved changes</h2>
          <p id="discard-message"></p>
          <div class="dialog-buttons">
            <button class="btn-dialog-cancel" id="dialog-discard-cancel">Keep editing</button>
            <button class="btn-primary" id="dialog-discard-confirm">
              Discard and open
            </button>
          </div>
        </div>
      </dialog>
    `;
  }

  // ------------------------------------------------------------------
  // Event listeners
  // ------------------------------------------------------------------

  _attachEventListeners() {
    const root = this.shadowRoot;

    // Sort headers
    root.querySelectorAll("[data-sort]").forEach(el => {
      el.addEventListener("click", () => this._handleSort(el.dataset.sort));
    });

    // Collapsed row click — open editor
    root.querySelectorAll(".object-row").forEach(row => {
      row.addEventListener("click", () => this._handleRowClick(row.dataset.uuid));
    });

    // Add button (list view only)
    const btnAdd = root.getElementById("btn-add");
    if (btnAdd) btnAdd.addEventListener("click", () => this._handleAdd());

    // Editor buttons
    const btnSave = root.getElementById("btn-save");
    if (btnSave) btnSave.addEventListener("click", () => this._handleSave());

    const btnCancel = root.getElementById("btn-cancel");
    if (btnCancel) btnCancel.addEventListener("click", () => this._handleCancel());

    const btnRestore = root.getElementById("btn-restore");
    if (btnRestore) btnRestore.addEventListener("click", () => this._handleRestore());

    const btnDelete = root.getElementById("btn-delete");
    if (btnDelete) btnDelete.addEventListener("click", () => this._handleDeleteClick());

    // Track field changes for dirty state
    const fieldName = root.getElementById("field-name");
    if (fieldName) fieldName.addEventListener("input", e => {
      this._form.name = e.target.value;
      this._updateSaveButton();
    });

    const fieldId = root.getElementById("field-object-id");
    if (fieldId) fieldId.addEventListener("input", e => {
      this._form.object_id = e.target.value;
      this._updateSaveButton();
    });

    const fieldDesc = root.getElementById("field-description");
    if (fieldDesc) fieldDesc.addEventListener("input", e => {
      this._form.description = e.target.value;
      this._updateSaveButton();
    });

    // Note: ha-code-editor value-changed is wired in _render() after DOM exists

    // Note: ha-code-editor handles tab key natively via CodeMirror

    // Dialog buttons
    root.getElementById("dialog-delete-cancel")
      ?.addEventListener("click", () => root.getElementById("dialog-delete").close());
    root.getElementById("dialog-delete-confirm")
      ?.addEventListener("click", () => this._handleDeleteConfirm());

    root.getElementById("dialog-rename-cancel")
      ?.addEventListener("click", () => root.getElementById("dialog-rename").close());
    root.getElementById("dialog-rename-confirm")
      ?.addEventListener("click", () => this._handleRenameConfirm());

    root.getElementById("dialog-discard-cancel")
      ?.addEventListener("click", () => root.getElementById("dialog-discard").close());
    root.getElementById("dialog-discard-confirm")
      ?.addEventListener("click", () => this._handleDiscardConfirm());
  }

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  _handleSort(column) {
    if (this._sortBy === column) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortBy = column;
      this._sortAsc = column !== "updated"; // default: updated desc, others asc
    }
    this._render();
  }

  async _handleRowClick(uuid) {
    if (this._isDirty()) {
      this._pendingUuid = uuid;
      const obj = this._objects.find(o => o.uuid === this._editingUuid);
      const other = this._objects.find(o => o.uuid === uuid);
      const msg = this.shadowRoot.getElementById("discard-message");
      if (msg) {
        msg.textContent = `You have unsaved changes to "${obj?.name || "this object"}". ` +
          `Discard them and open "${other?.name || "the selected object"}"?`;
      }
      this.shadowRoot.getElementById("dialog-discard").showModal();
      return;
    }
    await this._openEditor(uuid);
  }

  _handleAdd() {
    if (this._isDirty()) {
      this._pendingAdd = true;
      const obj = this._objects.find(o => o.uuid === this._editingUuid);
      const msg = this.shadowRoot.getElementById("discard-message");
      if (msg) {
        msg.textContent = `You have unsaved changes to "${obj?.name || "this object"}". ` +
          `Discard them and add a new object?`;
      }
      this.shadowRoot.getElementById("dialog-discard").showModal();
      return;
    }
    this._openAdd();
  }

  _handleCancel() {
    this._closeEditor();
  }

  async _handleRestore() {
    // Fetch fresh data from backend — gives user the actual current saved state,
    // not just the local snapshot from when the editor was opened.
    this._errorMessage = null;
    this._warnMessage = null;
    await this._openEditor(this._editingUuid);
  }

  async _handleSave() {
    this._errorMessage = null;
    const form = this._form;

    // Basic required field check
    if (!form.name.trim() || !form.object_id.trim()) {
      this._errorMessage = "Name and Object ID are required.";
      this._render();
      return;
    }

    // Check if object_id is being renamed (edit mode only)
    const original = this._originalForm;
    if (!this._isAdding && original && form.object_id !== original.object_id) {
      const oldId = this.shadowRoot.getElementById("rename-old-id");
      const newId = this.shadowRoot.getElementById("rename-new-id");
      if (oldId) oldId.textContent = original.object_id;
      if (newId) newId.textContent = form.object_id;
      this.shadowRoot.getElementById("dialog-rename").showModal();
      return;
    }

    await this._submitSave();
  }

  async _handleRenameConfirm() {
    this.shadowRoot.getElementById("dialog-rename").close();
    await this._submitSave();
  }

  async _submitSave() {
    const form = this._form;

    // Safety net: read editor value directly from DOM before submitting
    const mount = this.shadowRoot.getElementById("code-editor-mount");
    const editor = mount ? mount.querySelector("ha-code-editor") : null;
    if (editor && editor.value !== undefined && editor.value !== null) {
      form.data = editor.value;
    }

    try {
      if (this._isAdding) {
        await this._hass.callWS({
          type: "object_registry/create",
          object_id: form.object_id.trim(),
          name: form.name.trim(),
          description: form.description.trim(),
          data: form.data,
        });
      } else {
        await this._hass.callWS({
          type: "object_registry/update",
          uuid: this._editingUuid,
          object_id: form.object_id.trim(),
          name: form.name.trim(),
          description: form.description.trim(),
          data: form.data,
        });
      }
      this._closeEditor();
      await this._load();
    } catch (err) {
      this._errorMessage = err.message || "An error occurred. Please try again.";
      this._render();
    }
  }

  _handleDeleteClick() {
    this.shadowRoot.getElementById("dialog-delete").showModal();
  }

  async _handleDeleteConfirm() {
    this.shadowRoot.getElementById("dialog-delete").close();
    try {
      await this._hass.callWS({
        type: "object_registry/delete",
        uuid: this._editingUuid,
      });
      this._closeEditor();
      await this._load();
    } catch (err) {
      this._errorMessage = err.message || "Delete failed. Please try again.";
      this._render();
    }
  }

  async _handleDiscardConfirm() {
    this.shadowRoot.getElementById("dialog-discard").close();
    if (this._pendingAdd) {
      this._pendingAdd = false;
      this._openAdd();
    } else if (this._pendingUuid) {
      const uuid = this._pendingUuid;
      this._pendingUuid = null;
      await this._openEditor(uuid);
    }
  }

  // ------------------------------------------------------------------
  // Editor state helpers
  // ------------------------------------------------------------------

  async _openEditor(uuid) {
    // Fetch the full object including data payload from the backend.
    // The list view only has metadata (list_items strips the payload),
    // so we need a separate get call to load the data field.
    let obj;
    try {
      obj = await this._hass.callWS({ type: "object_registry/get", uuid });
    } catch (err) {
      console.error("Object Registry: failed to load object", err);
      return;
    }
    if (!obj) return;

    this._editingUuid = uuid;
    this._isAdding = false;
    this._form = {
      name: obj.name,
      object_id: obj.object_id,
      description: obj.description || "",
      data: typeof obj.data === "string" ? obj.data : JSON.stringify(obj.data, null, 2),
    };
    this._originalForm = { ...this._form };
    this._errorMessage = null;
    this._warnMessage = null;
    this._render();
  }

  _openAdd() {
    this._editingUuid = null;
    this._isAdding = true;
    this._form = _emptyForm();
    this._originalForm = { ..._emptyForm() };
    this._errorMessage = null;
    this._warnMessage = null;
    this._render();
  }

  _closeEditor() {
    this._editingUuid = null;
    this._isAdding = false;
    this._form = _emptyForm();
    this._originalForm = null;
    this._errorMessage = null;
    this._warnMessage = null;
    this._render();
  }

  _isDirty() {
    if (!this._originalForm) return false;
    return (
      this._form.name !== this._originalForm.name ||
      this._form.object_id !== this._originalForm.object_id ||
      this._form.description !== this._originalForm.description ||
      this._form.data !== this._originalForm.data
    );
  }

  _updateSaveButton() {
    const btn = this.shadowRoot.getElementById("btn-save");
    if (btn) btn.disabled = !this._isDirty();
  }

  _sortedObjects() {
    const sorted = [...this._objects].sort((a, b) => {
      let valA = a[this._sortBy] || "";
      let valB = b[this._sortBy] || "";
      if (this._sortBy === "updated") {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      } else {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      if (valA < valB) return this._sortAsc ? -1 : 1;
      if (valA > valB) return this._sortAsc ? 1 : -1;
      return 0;
    });
    return sorted;
  }
}

// ------------------------------------------------------------------
// Private helpers (module-level, not on the class)
// ------------------------------------------------------------------

function _emptyForm() {
  return {
    name: "",
    object_id: "",
    description: "",
    data: '{\n  "key": "value"\n}',
  };
}

function _escape(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _relativeTime(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `last month`;
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) !== 1 ? "s" : ""} ago`;
}

function _formatDateTime(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleString();
}

function _styles() {
  return `
    :host {
      display: block;
      height: 100%;
      background: var(--primary-background-color);
      color: var(--primary-text-color);
      font-family: var(--paper-font-body1_-_font-family, 'Roboto', sans-serif);
      font-size: 14px;
      box-sizing: border-box;
    }

    *, *::before, *::after { box-sizing: border-box; }

    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .panel-header {
      padding: 16px 24px 0;
    }

    .panel-header h1 {
      margin: 0 0 16px;
      font-size: var(--sidebar-title-font-size, 20px);
      font-weight: var(--sidebar-font-weight, 400);
      color: var(--sidebar-text-color, var(--primary-text-color));
      line-height: 1.2;
    }

    /* ---- List view ---- */

    .list-view {
      flex: 1;
      overflow-y: auto;
      padding: 0 24px;
    }

    /* ---- Split view ---- */

    .split-view {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }

    .split-top {
      flex: 0 0 33%;
      overflow-y: auto;
      padding: 0 24px;
      border-bottom: 1px solid var(--disabled-text-color);
    }

    .split-bottom {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ---- Table ---- */

    .table-header,
    .object-row {
      display: grid;
      grid-template-columns: 48px 1fr 180px 140px 80px 40px;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--divider-color);
    }

    .object-row > div:nth-child(2) {
      min-width: 0;
      padding-right: 12px;
    }

    .table-header {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--primary-background-color);
      font-weight: 500;
      color: var(--secondary-text-color);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 0 8px;
      align-items: center;
    }
    /* Sticky header in split-top uses secondary background */
    .split-top .table-header {
      background: var(--primary-background-color);
    }

    .object-row {
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.1s;
    }

    .object-row:hover {
      background: var(--secondary-background-color);
    }

    .sortable {
      cursor: pointer;
      user-select: none;
    }

    .sortable:hover,
    .sorted {
      color: var(--primary-color);
    }

    .obj-icon {
      width: 28px;
      height: 28px;
      color: var(--secondary-text-color);
      opacity: 0.7;
    }

    .obj-icon svg {
      width: 100%;
      height: 100%;
    }

    .obj-name {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .obj-desc {
      color: var(--secondary-text-color);
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
    }

    .obj-id {
      color: var(--secondary-text-color);
      font-family: 'Roboto Mono', monospace;
      font-size: 0.95em;
    }

    .obj-updated {
      color: var(--secondary-text-color);
    }

    .obj-type {
      font-weight: 400;
      color: var(--secondary-text-color);
      font-size: 14px;
    }

    .chevron {
      color: var(--secondary-text-color);
      font-size: 18px;
    }

    .empty-state,
    .empty-split {
      padding: 32px;
      text-align: center;
      color: var(--secondary-text-color);
    }

    /* ---- Editor ---- */

    .editor {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--secondary-background-color);
      overflow: hidden;
    }

    .editor-header {
      display: grid;
      grid-template-columns: 48px 1fr;
      gap: 0;
      padding: 8px 24px 4px 24px;
      align-items: start;
    }

    .editor-fields {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .editor-row-top {
      display: grid;
      grid-template-columns: 1fr 320px 80px 40px;
      gap: 0;
      align-items: end;
      padding-right: 0;
    }

    .field-name {
      padding-right: 8px;
    }

    .field-object-id {
      padding-right: 12px;
    }

    .editor-type-badge {
      display: flex;
      align-items: flex-end;
      padding-bottom: 7px;
      padding-left: -4px;
      font-weight: 400;
      color: var(--secondary-text-color);
      font-size: 14px;
    }

    .editor-row-desc {
      display: grid;
      padding-right: 4px;
      grid-template-columns: 1fr 320px 80px 40px;
      gap: 0;
    }

    .editor-row-desc > div {
      grid-column: 1 / 3;
      padding-right: 8px;
    }

    .editor-timestamps {
      display: grid;
      grid-template-columns: 1fr 320px 80px 40px;
      gap: 0;
      font-size: 12px;
      color: var(--secondary-text-color);
      padding-top: 2px;
    }

    .editor-timestamps span {
      grid-column: 1 / 3;
      display: flex;
      gap: 24px;
    }

    .field-label {
      display: block;
      font-size: 12px;
      color: var(--secondary-text-color);
      margin-bottom: 3px;
    }

    .ha-input {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }

    .ha-input:focus {
      border-color: var(--primary-color);
    }

    .ha-input-full {
      flex: 1;
    }

    #field-object-id {
      font-family: 'Roboto Mono', monospace;
      font-size: 0.95em;
    }

    /* ---- Banners ---- */
    /* ha-alert handles all theming internally — we just control margin */

    .banner {
      margin: 4px 24px;
      display: block;
    }

    /* ---- Code editor ---- */

    .code-editor-wrapper {
      flex: 1 1 0%;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      margin: 4px 24px 8px 24px;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
    }

    ha-code-editor {
      flex: 1 1 0%;
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    /* ---- Button row ---- */

    .editor-buttons {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 24px 18px 24px;
      background: var(--secondary-background-color);
      flex-shrink: 0;
    }

    .btn-left,
    .btn-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Save — solid teal pill with floppy icon */
    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 20px;
      border: none;
      border-radius: 24px;
      background: var(--primary-color);
      color: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      line-height: 1.4;
      transition: opacity 0.15s;
    }

    .btn-primary:disabled {
      opacity: 0.4;
      cursor: default;
    }

    /* Cancel in dialogs — outlined pill */
    .btn-secondary {
      padding: 8px 20px;
      border: 2px solid var(--primary-color);
      border-radius: 24px;
      background: transparent;
      color: var(--primary-color);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-secondary:hover {
      background: rgba(var(--rgb-primary-color, 3,169,244), 0.1);
    }

    /* Restore — text only, blue pill on hover */
    .btn-text {
      padding: 8px 16px;
      border: none;
      border-radius: 24px;
      background: transparent;
      color: var(--primary-color);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-text:hover {
      background: rgba(var(--rgb-primary-color, 3,169,244), 0.1);
    }

    /* Delete object — text only, red pill on hover */
    .btn-delete {
      padding: 8px 16px;
      border: none;
      border-radius: 24px;
      background: transparent;
      color: var(--error-color, #f44336);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-delete:hover {
      background: rgba(var(--rgb-error-color, 244,67,54), 0.1);
    }

    /* Delete in dialog — solid red pill */
    .btn-danger {
      padding: 8px 20px;
      border: none;
      border-radius: 24px;
      background: var(--error-color, #f44336);
      color: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .btn-danger:hover {
      opacity: 0.9;
    }

    /* Dialog cancel — text only, blue pill on hover */
    .btn-dialog-cancel {
      padding: 8px 20px;
      border: none;
      border-radius: 24px;
      background: transparent;
      color: var(--primary-color);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-dialog-cancel:hover {
      background: rgba(var(--rgb-primary-color, 3,169,244), 0.15);
    }

    /* ---- FAB ---- */

    .fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 20px;
      border: none;
      border-radius: 24px;
      background: var(--primary-color);
      color: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    .fab-icon {
      font-size: 20px;
      line-height: 1;
    }

    /* ---- Dialogs ---- */

    dialog {
      border: none;
      border-radius: 8px;
      padding: 0;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      max-width: 440px;
      width: 90%;
    }

    dialog::backdrop {
      background: rgba(0,0,0,0.5);
    }

    .dialog-content {
      padding: 24px;
    }

    .dialog-content h2 {
      margin: 0 0 12px;
      font-size: 18px;
      font-weight: 500;
    }

    .dialog-content p {
      margin: 0 0 20px;
      color: var(--secondary-text-color);
      line-height: 1.5;
    }

    .dialog-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `;
}

// ------------------------------------------------------------------
// Module-scope visibility handler for disappearing panel workaround.
//
// Problem: After ~5 min in a background tab, Chrome throttles JS and
// HA's partial-panel-resolver removes <object-registry-panel> from the
// DOM entirely. When the tab returns, HA's router thinks it's already
// on this panel route and won't remount. Panel stays blank.
//
// Why module scope: A listener attached in connectedCallback dies when
// the element is removed. This listener lives outside the class so it
// survives element removal and persists for the page lifetime.
//
// Fix: On tab return, if we're on the panel route, dispatch HA's own
// location-changed event (not popstate — HA's Lit router ignores that)
// to navigate away and back, forcing a clean remount. Cost is one
// WebSocket reload per tab return. Any unsaved editor state is already
// lost since HA destroyed the element during throttling.
//
// Guard prevents double-registration across hot reloads.
// ------------------------------------------------------------------

if (!window._objectRegistryVisibilityHandler) {
  window._objectRegistryVisibilityHandler = () => {
    if (document.visibilityState !== "visible") return;
    if (window.location.pathname !== "/object_registry") return;

    // Navigate away then back using HA's router event.
    // Two dispatches are required: the first moves the router off this
    // route, the second brings it back — triggering a full remount.
    // setTimeout between them gives the Lit router one tick to process
    // the navigate-away before we send the navigate-back. Without this
    // the router batches both events and ignores the round-trip.
    window.history.pushState(null, "", "/");
    window.dispatchEvent(
      new CustomEvent("location-changed", { bubbles: true })
    );
    setTimeout(() => {
      window.history.pushState(null, "", "/object_registry");
      window.dispatchEvent(
        new CustomEvent("location-changed", { bubbles: true })
      );
    }, 100);
  };
  document.addEventListener(
    "visibilitychange",
    window._objectRegistryVisibilityHandler
  );
}

if (!customElements.get("object-registry-panel")) {
  customElements.define("object-registry-panel", ObjectRegistryPanel);
}