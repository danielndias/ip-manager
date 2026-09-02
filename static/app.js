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
      <td><input type="text" class="hostname" value="${hostname}" placeholder="e.g. printer"></td>
      <td><input type="text" class="description" value="${description}" placeholder="notes"></td>
      <td><input type="text" class="mac_address" value="${mac_address}" placeholder="AA:BB:CC:DD:EE:FF"></td>
      <td class="col-actions">
        <button type="button" class="save-row">Save</button>
        <button type="button" class="remove-row danger">Remove</button>
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
      const saveBtn = event.target.closest(".save-row");
      const removeBtn = event.target.closest(".remove-row");
      if (!saveBtn && !removeBtn) return;

      const row = event.target.closest("tr");
      const ip = row.dataset.ip;
      const message = row.querySelector(".row-message");

      if (removeBtn) {
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
