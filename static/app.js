(function () {
  const script = document.currentScript;
  const saveUrl = script.dataset.saveUrl;
  const removeUrl = script.dataset.removeUrl;

  const table = document.getElementById("host-table");
  const tbody = table ? table.querySelector("tbody") : null;
  const addForm = document.getElementById("add-host-form");
  const addSelect = document.getElementById("add-ip");
  const addMessage = document.getElementById("add-host-message");
  const usedCountEl = document.getElementById("used-count");
  const noHostsMessage = document.getElementById("no-hosts-message");

  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
  const CANCEL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function ipToInt(ip) {
    return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
  }

  function updateUsedCount(delta) {
    if (!usedCountEl) return;
    usedCountEl.textContent = String(Number(usedCountEl.textContent) + delta);
  }

  function toggleEmptyState() {
    if (!tbody) return;
    const hasRows = tbody.querySelectorAll("tr").length > 0;
    if (noHostsMessage) noHostsMessage.style.display = hasRows ? "none" : "";
  }

  function insertIpOption(ip) {
    if (!addSelect) return;
    // clear the "no free addresses" placeholder if present
    const placeholder = addSelect.querySelector('option[value=""]');
    if (placeholder) placeholder.remove();

    const option = document.createElement("option");
    option.value = ip;
    option.textContent = ip;

    const target = ipToInt(ip);
    const existing = Array.from(addSelect.options);
    const before = existing.find((opt) => ipToInt(opt.value) > target);
    if (before) {
      addSelect.insertBefore(option, before);
    } else {
      addSelect.appendChild(option);
    }

    addSelect.disabled = false;
    const submitBtn = addForm.querySelector("button[type=submit]");
    if (submitBtn) submitBtn.disabled = false;
  }

  function removeIpOption(ip) {
    if (!addSelect) return;
    const option = Array.from(addSelect.options).find((opt) => opt.value === ip);
    if (option) option.remove();
    if (addSelect.options.length === 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "No free addresses left";
      addSelect.appendChild(placeholder);
      addSelect.disabled = true;
      const submitBtn = addForm.querySelector("button[type=submit]");
      if (submitBtn) submitBtn.disabled = true;
    }
  }

  function buildRow(ip, hostname, description, mac_address) {
    const row = document.createElement("tr");
    row.dataset.ip = ip;
    row.innerHTML = `
      <td class="col-ip"><code>${ip}</code></td>
      <td><input type="text" class="hostname" value="${hostname}" placeholder="e.g. printer" readonly></td>
      <td><input type="text" class="description" value="${description}" placeholder="notes" readonly></td>
      <td><input type="text" class="mac_address" value="${mac_address}" placeholder="AA:BB:CC:DD:EE:FF" readonly></td>
      <td class="col-actions">
        <button type="button" class="icon-btn edit-row" title="Edit" aria-label="Edit">${EDIT_ICON}</button>
        <button type="button" class="icon-btn save-row" title="Save" aria-label="Save">${SAVE_ICON}</button>
        <button type="button" class="icon-btn cancel-row" title="Discard changes" aria-label="Discard changes">${CANCEL_ICON}</button>
        <button type="button" class="icon-btn remove-row" title="Remove" aria-label="Remove">${TRASH_ICON}</button>
        <span class="row-message"></span>
      </td>
    `;
    return row;
  }

  function insertRow(row) {
    const target = ipToInt(row.dataset.ip);
    const existingRows = Array.from(tbody.querySelectorAll("tr"));
    const before = existingRows.find((r) => ipToInt(r.dataset.ip) > target);
    if (before) {
      tbody.insertBefore(row, before);
    } else {
      tbody.appendChild(row);
    }
    toggleEmptyState();
  }

  function setEditing(row, editing) {
    const inputs = row.querySelectorAll("input");
    if (editing) {
      row._original = {
        hostname: row.querySelector(".hostname").value,
        description: row.querySelector(".description").value,
        mac_address: row.querySelector(".mac_address").value,
      };
    }
    inputs.forEach((input) => {
      input.readOnly = !editing;
    });
    row.querySelector(".remove-row").disabled = editing;
    row.classList.toggle("editing", editing);
    if (editing) inputs[0].focus();
  }

  function cancelEditing(row) {
    if (row._original) {
      row.querySelector(".hostname").value = row._original.hostname;
      row.querySelector(".description").value = row._original.description;
      row.querySelector(".mac_address").value = row._original.mac_address;
      row._original = null;
    }
    setEditing(row, false);
  }

  if (addForm) {
    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ip = addSelect.value;
      if (!ip) return;

      const hostname = document.getElementById("add-hostname").value.trim();
      const description = document.getElementById("add-description").value.trim();
      const mac_address = document.getElementById("add-mac").value.trim();

      const submitBtn = addForm.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      addMessage.textContent = "Adding...";
      addMessage.className = "row-message";

      try {
        const res = await fetch(saveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip, hostname, description, mac_address }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Add failed");

        if (data.removed) {
          addMessage.textContent = "Enter at least one field.";
          addMessage.className = "row-message error";
          return;
        }

        insertRow(buildRow(ip, data.hostname, data.description, data.mac_address));
        removeIpOption(ip);
        updateUsedCount(1);
        addForm.reset();
        addMessage.textContent = "Added";
        addMessage.className = "row-message success";
      } catch (err) {
        addMessage.textContent = err.message;
        addMessage.className = "row-message error";
      } finally {
        submitBtn.disabled = addSelect.disabled;
        setTimeout(() => {
          addMessage.textContent = "";
          addMessage.className = "row-message";
        }, 2500);
      }
    });
  }

  if (table) {
    table.addEventListener("click", async (event) => {
      const editBtn = event.target.closest(".edit-row");
      const saveBtn = event.target.closest(".save-row");
      const cancelBtn = event.target.closest(".cancel-row");
      const removeBtn = event.target.closest(".remove-row");
      if (!editBtn && !saveBtn && !cancelBtn && !removeBtn) return;

      const row = event.target.closest("tr");
      const ip = row.dataset.ip;
      const message = row.querySelector(".row-message");

      if (editBtn) {
        setEditing(row, true);
        return;
      }

      if (cancelBtn) {
        cancelEditing(row);
        return;
      }

      if (removeBtn) {
        if (removeBtn.disabled) return;
        removeBtn.disabled = true;
        message.textContent = "Removing...";
        try {
          const res = await fetch(removeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ip }),
          });
          if (!res.ok) throw new Error("Remove failed");
          row.remove();
          insertIpOption(ip);
          updateUsedCount(-1);
          toggleEmptyState();
        } catch (err) {
          message.textContent = err.message;
          message.className = "row-message error";
          removeBtn.disabled = false;
        }
        return;
      }

      // saveBtn
      const hostname = row.querySelector(".hostname").value.trim();
      const description = row.querySelector(".description").value.trim();
      const mac_address = row.querySelector(".mac_address").value.trim();

      saveBtn.disabled = true;
      message.textContent = "Saving...";
      message.className = "row-message";

      try {
        const res = await fetch(saveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip, hostname, description, mac_address }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");

        if (data.removed) {
          row.remove();
          insertIpOption(ip);
          updateUsedCount(-1);
          toggleEmptyState();
          return;
        }

        row.querySelector(".mac_address").value = data.mac_address;
        row._original = null;
        setEditing(row, false);
        message.textContent = "Saved";
        message.className = "row-message success";
      } catch (err) {
        message.textContent = err.message;
        message.className = "row-message error";
      } finally {
        saveBtn.disabled = false;
        setTimeout(() => {
          message.textContent = "";
          message.className = "row-message";
        }, 2500);
      }
    });
  }
})();
