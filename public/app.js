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
      } else if (tab.dataset.tab === "dishes") {
        loadDishManager();
        loadComboManager();
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

  // ── Комбо-пикер (вкладка "Новое мероприятие") ──────────────────────────────
  const comboPickerEl = document.getElementById("combo-picker");

  async function loadComboPicker() {
    try {
      const data = await api("/api/combos");
      comboPickerEl.innerHTML = "";
      data.combos.forEach((combo) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "combo-chip";
        chip.textContent = combo.name;
        chip.addEventListener("click", () => applyCombo(combo));
        comboPickerEl.appendChild(chip);
      });
    } catch (e) {
      comboPickerEl.innerHTML = "";
    }
  }

  function applyCombo(combo) {
    combo.dish_ids.forEach((id) => {
      const checkbox = document.getElementById("dish-" + id);
      if (checkbox && !checkbox.checked) {
        checkbox.checked = true;
        selectedDishIds.add(id);
      }
    });
    scheduleRecalc();
  }

  // ── Каталог блюд (вкладка "Блюда") ──────────────────────────────────────────
  const CATEGORY_OPTIONS = ["Салаты", "Горячее", "Гарниры", "Закуски", "Десерты"];
  const UNIT_OPTIONS = ["г", "мл", "шт", "кг", "л"];

  const dishListEl = document.getElementById("dish-list");
  const dishFormEl = document.getElementById("dish-form");
  const newDishBtn = document.getElementById("new-dish-btn");

  async function loadDishManager() {
    try {
      const data = await api("/api/dishes");
      dishListEl.innerHTML = "";
      Object.entries(data.categories).forEach(([category, dishes]) => {
        const block = document.createElement("div");
        block.className = "category";
        const title = document.createElement("h3");
        title.textContent = category;
        block.appendChild(title);
        dishes.forEach((dish) => {
          const row = document.createElement("div");
          row.className = "dish-list-item";
          const name = document.createElement("span");
          name.className = "dish-list-name";
          name.textContent = dish.name;
          const editBtn = document.createElement("button");
          editBtn.className = "edit-btn";
          editBtn.textContent = "Редактировать";
          editBtn.addEventListener("click", () => openDishForm(dish.id));
          row.appendChild(name);
          row.appendChild(editBtn);
          block.appendChild(row);
        });
        dishListEl.appendChild(block);
      });
    } catch (e) {
      dishListEl.innerHTML = `<div class="empty-state">Ошибка загрузки: ${e.message}</div>`;
    }
  }

  newDishBtn.addEventListener("click", () => openDishForm(null));

  async function openDishForm(dishId) {
    let dish = {
      name: "",
      category: CATEGORY_OPTIONS[0],
      serves: 1,
      ingredients: [{ name: "", amount: "", unit: "г" }],
    };
    if (dishId) {
      try {
        dish = await api(`/api/dishes/${dishId}`);
        if (!dish.ingredients.length) {
          dish.ingredients = [{ name: "", amount: "", unit: "г" }];
        }
      } catch (e) {
        notify("Не удалось загрузить блюдо: " + e.message);
        return;
      }
    }
    renderDishForm(dish, dishId);
  }

  function renderDishForm(dish, dishId) {
    dishFormEl.classList.remove("hidden");
    dishFormEl.innerHTML = "";

    const nameField = document.createElement("input");
    nameField.type = "text";
    nameField.className = "form-input";
    nameField.placeholder = "Название блюда";
    nameField.value = dish.name;

    const categorySelect = document.createElement("select");
    categorySelect.className = "form-input";
    CATEGORY_OPTIONS.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      if (cat === dish.category) opt.selected = true;
      categorySelect.appendChild(opt);
    });

    const servesField = document.createElement("input");
    servesField.type = "number";
    servesField.className = "form-input";
    servesField.min = "1";
    servesField.value = dish.serves;
    servesField.placeholder = "Порций на N гостей";

    const ingredientsBox = document.createElement("div");
    const ingredients = dish.ingredients.map((i) => ({ ...i }));

    function renderIngredientRows() {
      ingredientsBox.innerHTML = "";
      ingredients.forEach((ing, idx) => {
        const row = document.createElement("div");
        row.className = "ingredient-edit-row";

        const ingName = document.createElement("input");
        ingName.className = "ing-name";
        ingName.placeholder = "Ингредиент";
        ingName.value = ing.name;
        ingName.addEventListener("input", () => (ing.name = ingName.value));

        const ingAmount = document.createElement("input");
        ingAmount.className = "ing-amount";
        ingAmount.type = "number";
        ingAmount.placeholder = "Кол-во";
        ingAmount.value = ing.amount;
        ingAmount.addEventListener("input", () => (ing.amount = ingAmount.value));

        const unitSelect = document.createElement("select");
        unitSelect.className = "ing-unit";
        UNIT_OPTIONS.forEach((u) => {
          const opt = document.createElement("option");
          opt.value = u;
          opt.textContent = u;
          if (u === ing.unit) opt.selected = true;
          unitSelect.appendChild(opt);
        });
        unitSelect.addEventListener("change", () => (ing.unit = unitSelect.value));

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "remove-ing-btn";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          ingredients.splice(idx, 1);
          renderIngredientRows();
        });

        row.appendChild(ingName);
        row.appendChild(ingAmount);
        row.appendChild(unitSelect);
        row.appendChild(removeBtn);
        ingredientsBox.appendChild(row);
      });
    }
    renderIngredientRows();

    const addIngBtn = document.createElement("button");
    addIngBtn.type = "button";
    addIngBtn.className = "secondary-btn";
    addIngBtn.textContent = "+ Ингредиент";
    addIngBtn.addEventListener("click", () => {
      ingredients.push({ name: "", amount: "", unit: "г" });
      renderIngredientRows();
    });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save-btn";
    saveBtn.textContent = dishId ? "Сохранить изменения" : "Создать блюдо";
    saveBtn.addEventListener("click", async () => {
      const payload = {
        name: nameField.value.trim(),
        category: categorySelect.value,
        serves: parseInt(servesField.value, 10) || 1,
        ingredients: ingredients
          .filter((i) => i.name.trim() && i.amount)
          .map((i) => ({ name: i.name.trim(), amount: parseFloat(i.amount), unit: i.unit })),
      };
      if (!payload.name) {
        notify("Введите название блюда");
        return;
      }
      if (!payload.ingredients.length) {
        notify("Добавьте хотя бы один ингредиент");
        return;
      }
      try {
        if (dishId) {
          await api(`/api/dishes/${dishId}`, { method: "PUT", body: JSON.stringify(payload) });
        } else {
          await api("/api/dishes", { method: "POST", body: JSON.stringify(payload) });
        }
        dishFormEl.classList.add("hidden");
        loadDishManager();
        loadDishes();
        notify("Сохранено");
      } catch (e) {
        notify("Ошибка сохранения: " + e.message);
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary-btn";
    cancelBtn.textContent = "Отмена";
    cancelBtn.addEventListener("click", () => dishFormEl.classList.add("hidden"));

    dishFormEl.appendChild(nameField);
    dishFormEl.appendChild(categorySelect);
    dishFormEl.appendChild(servesField);
    dishFormEl.appendChild(ingredientsBox);
    dishFormEl.appendChild(addIngBtn);

    if (dishId) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "Удалить блюдо";
      deleteBtn.addEventListener("click", async () => {
        const doDelete = async () => {
          await api(`/api/dishes/${dishId}`, { method: "DELETE" });
          dishFormEl.classList.add("hidden");
          loadDishManager();
          loadDishes();
        };
        if (isTelegram) {
          tg.showConfirm("Удалить блюдо?", (ok) => {
            if (ok) doDelete();
          });
        } else if (confirm("Удалить блюдо?")) {
          doDelete();
        }
      });
      dishFormEl.appendChild(deleteBtn);
    }

    dishFormEl.appendChild(saveBtn);
    dishFormEl.appendChild(cancelBtn);
  }

  // ── Комбо (вкладка "Блюда") ──────────────────────────────────────────────────
  const comboListEl = document.getElementById("combo-list");
  const comboFormEl = document.getElementById("combo-form");
  const newComboBtn = document.getElementById("new-combo-btn");

  async function loadComboManager() {
    try {
      const data = await api("/api/combos");
      comboListEl.innerHTML = "";
      if (!data.combos.length) {
        comboListEl.innerHTML = '<div class="empty-state">Пока нет комбо</div>';
      }
      data.combos.forEach((combo) => {
        const item = document.createElement("div");
        item.className = "combo-item";
        const name = document.createElement("span");
        name.className = "combo-name";
        name.textContent = `${combo.name} (${combo.dish_ids.length} блюд)`;
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.textContent = "Удалить";
        deleteBtn.addEventListener("click", async () => {
          const doDelete = async () => {
            await api(`/api/combos/${combo.id}`, { method: "DELETE" });
            loadComboManager();
            loadComboPicker();
          };
          if (isTelegram) {
            tg.showConfirm("Удалить комбо?", (ok) => {
              if (ok) doDelete();
            });
          } else if (confirm("Удалить комбо?")) {
            doDelete();
          }
        });
        item.appendChild(name);
        item.appendChild(deleteBtn);
        comboListEl.appendChild(item);
      });
    } catch (e) {
      comboListEl.innerHTML = `<div class="empty-state">Ошибка: ${e.message}</div>`;
    }
  }

  newComboBtn.addEventListener("click", () => openComboForm());

  async function openComboForm() {
    comboFormEl.classList.remove("hidden");
    comboFormEl.innerHTML = "";

    const nameField = document.createElement("input");
    nameField.type = "text";
    nameField.className = "form-input";
    nameField.placeholder = "Название комбо";

    const dishesBox = document.createElement("div");
    const selected = new Set();

    try {
      const data = await api("/api/dishes");
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
          checkbox.id = "combo-dish-" + dish.id;
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) selected.add(dish.id);
            else selected.delete(dish.id);
          });
          const label = document.createElement("label");
          label.htmlFor = checkbox.id;
          label.textContent = dish.name;
          row.appendChild(checkbox);
          row.appendChild(label);
          block.appendChild(row);
        });
        dishesBox.appendChild(block);
      });
    } catch (e) {
      dishesBox.innerHTML = `<div class="empty-state">Ошибка загрузки блюд: ${e.message}</div>`;
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save-btn";
    saveBtn.textContent = "Сохранить комбо";
    saveBtn.addEventListener("click", async () => {
      const name = nameField.value.trim();
      if (!name) {
        notify("Введите название комбо");
        return;
      }
      if (!selected.size) {
        notify("Выберите хотя бы одно блюдо");
        return;
      }
      try {
        await api("/api/combos", {
          method: "POST",
          body: JSON.stringify({ name, dish_ids: Array.from(selected) }),
        });
        comboFormEl.classList.add("hidden");
        loadComboManager();
        loadComboPicker();
        notify("Комбо сохранено");
      } catch (e) {
        notify("Ошибка сохранения: " + e.message);
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary-btn";
    cancelBtn.textContent = "Отмена";
    cancelBtn.addEventListener("click", () => comboFormEl.classList.add("hidden"));

    comboFormEl.appendChild(nameField);
    comboFormEl.appendChild(dishesBox);
    comboFormEl.appendChild(saveBtn);
    comboFormEl.appendChild(cancelBtn);
  }

  loadDishes();
  loadComboPicker();
})();
