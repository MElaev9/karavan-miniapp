(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "";
  // tg существует и вне настоящего Telegram (скрипт создаёт no-op заглушку),
  // поэтому UI-функции (MainButton, showAlert) включаем только при наличии initData —
  // это заполняется исключительно реальным Telegram-клиентом.
  const isTelegram = !!(tg && tg.initData);

  if (tg) {
    tg.ready();
    tg.expand();
  }

  function authHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (tg && tg.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }
    return headers;
  }

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".tab-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
      if (tab.dataset.tab === "archive") {
        loadArchive();
        if (isTelegram) tg.MainButton.hide();
      } else {
        if (isTelegram) tg.MainButton.show();
      }
    });
  });

  // ── New event form ───────────────────────────────────────────────────────
  const nameInput = document.getElementById("event-name");
  const guestsInput = document.getElementById("event-guests");
  const dateInput = document.getElementById("event-date");
  const categoriesEl = document.getElementById("dish-categories");
  const calcResultEl = document.getElementById("calc-result");

  let selectedDishIds = new Set();
  let recalcTimer = null;

  async function loadDishes() {
    try {
      const data = await api("/api/dishes");
      categoriesEl.innerHTML = "";
      Object.entries(data.categories).forEach(([category, dishes]) => {
        const block = document.createElement("div");
        block.className = "category";
        const title = document.createElement("h3");
        title.textContent = category;
        block.appendChild(title);
        dishes.forEach((dish) => {
          const row = document.createElement("div");
          row.className = "dish-row";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = "dish-" + dish.id;
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedDishIds.add(dish.id);
            else selectedDishIds.delete(dish.id);
            scheduleRecalc();
          });
          const label = document.createElement("label");
          label.htmlFor = checkbox.id;
          label.textContent = dish.name;
          row.appendChild(checkbox);
          row.appendChild(label);
          block.appendChild(row);
        });
        categoriesEl.appendChild(block);
      });
    } catch (e) {
      categoriesEl.innerHTML = `<div class="empty-state">Не удалось загрузить блюда: ${e.message}</div>`;
    }
  }

  function scheduleRecalc() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(recalc, 300);
  }

  function renderIngredients(container, ingredients) {
    if (!ingredients.length) {
      container.innerHTML = '<div class="empty-state">Выберите блюда и гостей</div>';
      return;
    }
    const byDept = {};
    ingredients.forEach((ing) => {
      if (!byDept[ing.department]) byDept[ing.department] = [];
      byDept[ing.department].push(ing);
    });
    container.innerHTML = "";
    Object.entries(byDept).forEach(([dept, items]) => {
      const group = document.createElement("div");
      group.className = "dept-group";
      const h = document.createElement("h4");
      h.textContent = dept;
      group.appendChild(h);
      items.forEach((ing) => {
        const row = document.createElement("div");
        row.className = "ingredient-row";
        row.innerHTML = `<span>${ing.name}</span><span>${formatAmount(ing.amount, ing.unit)}</span>`;
        group.appendChild(row);
      });
      container.appendChild(group);
    });
  }

  function formatAmount(amount, unit) {
    if (unit === "шт") return `${Math.round(amount)} шт`;
    return `${parseFloat(amount).toString()} ${unit}`;
  }

  async function recalc() {
    const guests = parseInt(guestsInput.value, 10);
    if (!guests || guests <= 0 || selectedDishIds.size === 0) {
      renderIngredients(calcResultEl, []);
      return;
    }
    try {
      const data = await api("/api/calculate", {
        method: "POST",
        body: JSON.stringify({ guests, dish_ids: Array.from(selectedDishIds) }),
      });
      renderIngredients(calcResultEl, data.ingredients);
    } catch (e) {
      calcResultEl.innerHTML = `<div class="empty-state">Ошибка расчёта: ${e.message}</div>`;
    }
  }

  guestsInput.addEventListener("input", scheduleRecalc);

  async function saveEvent() {
    const name = nameInput.value.trim();
    const guests = parseInt(guestsInput.value, 10);
    if (!name) {
      notify("Введите название мероприятия");
      return;
    }
    if (!guests || guests <= 0) {
      notify("Укажите количество гостей");
      return;
    }
    if (selectedDishIds.size === 0) {
      notify("Выберите хотя бы одно блюдо");
      return;
    }
    try {
      await api("/api/events", {
        method: "POST",
        body: JSON.stringify({
          name,
          guests,
          dish_ids: Array.from(selectedDishIds),
          event_date: dateInput.value || "",
        }),
      });
      notify("Мероприятие сохранено");
      nameInput.value = "";
      selectedDishIds.clear();
      document.querySelectorAll('#dish-categories input[type="checkbox"]').forEach((cb) => (cb.checked = false));
      renderIngredients(calcResultEl, []);
    } catch (e) {
      notify("Ошибка сохранения: " + e.message);
    }
  }

  function notify(message) {
    if (isTelegram) tg.showAlert(message);
    else alert(message);
  }

  if (isTelegram) {
    tg.MainButton.setText("Сохранить мероприятие");
    tg.MainButton.show();
    tg.MainButton.onClick(saveEvent);
  } else {
    const btn = document.createElement("button");
    btn.textContent = "Сохранить мероприятие";
    btn.className = "save-btn";
    btn.addEventListener("click", saveEvent);
    document.getElementById("tab-new").appendChild(btn);
  }

  // ── Archive ──────────────────────────────────────────────────────────────
  const archiveListEl = document.getElementById("archive-list");
  const eventCardEl = document.getElementById("event-card");

  async function loadArchive() {
    eventCardEl.classList.add("hidden");
    archiveListEl.classList.remove("hidden");
    try {
      const data = await api("/api/events");
      if (!data.events.length) {
        archiveListEl.innerHTML = '<div class="empty-state">Пока нет сохранённых мероприятий</div>';
        return;
      }
      archiveListEl.innerHTML = "";
      data.events.forEach((event) => {
        const item = document.createElement("div");
        item.className = "event-item";
        item.innerHTML = `<div class="event-name">${event.name}</div><div class="event-meta">${event.guests} гостей${event.event_date ? " · " + event.event_date : ""}</div>`;
        item.addEventListener("click", () => showEventCard(event.id));
        archiveListEl.appendChild(item);
      });
    } catch (e) {
      archiveListEl.innerHTML = `<div class="empty-state">Ошибка загрузки: ${e.message}</div>`;
    }
  }

  async function showEventCard(eventId) {
    try {
      const event = await api(`/api/events/${eventId}`);
      archiveListEl.classList.add("hidden");
      eventCardEl.classList.remove("hidden");
      eventCardEl.innerHTML = "";

      const backBtn = document.createElement("button");
      backBtn.className = "back-btn";
      backBtn.textContent = "← Назад";
      backBtn.addEventListener("click", loadArchive);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "Удалить";
      deleteBtn.addEventListener("click", async () => {
        const doDelete = async () => {
          await api(`/api/events/${eventId}`, { method: "DELETE" });
          loadArchive();
        };
        if (isTelegram) {
          tg.showConfirm("Удалить мероприятие?", (ok) => {
            if (ok) doDelete();
          });
        } else if (confirm("Удалить мероприятие?")) {
          doDelete();
        }
      });

      const title = document.createElement("h3");
      title.textContent = `${event.name} — ${event.guests} гостей${event.event_date ? " (" + event.event_date + ")" : ""}`;

      const ingredientsBox = document.createElement("div");
      renderIngredients(ingredientsBox, event.ingredients);

      eventCardEl.appendChild(backBtn);
      eventCardEl.appendChild(deleteBtn);
      eventCardEl.appendChild(title);
      eventCardEl.appendChild(ingredientsBox);
    } catch (e) {
      eventCardEl.innerHTML = `<div class="empty-state">Ошибка: ${e.message}</div>`;
    }
  }

  loadDishes();
})();
