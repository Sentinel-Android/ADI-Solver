(() => {
  // src/adi/units.mjs
  var unitGroups = {
    "Length": {
      "m": 1,
      "cm": 0.01,
      "mm": 1e-3,
      "km": 1e3,
      "inch": 0.0254,
      "ft": 0.3048
    },
    "Area": {
      "m^2": 1,
      "cm^2": 1e-4,
      "mm^2": 1e-6,
      "ft^2": 0.09290304,
      "inch^2": 64516e-8
    },
    "Volume": {
      "m^3": 1,
      "L": 1e-3,
      "mL": 1e-6,
      "cm^3": 1e-6,
      "ft^3": 0.028316846592
    },
    "Pressure": {
      "Pa": 1,
      "kPa": 1e3,
      "MPa": 1e6,
      "bar": 1e5,
      "atm": 101325,
      "psi": 6894.757293168
    },
    "Temperature": {
      "C": null,
      "K": null,
      "F": null
    },
    "Mass": {
      "kg": 1,
      "g": 1e-3,
      "mg": 1e-6,
      "tonne": 1e3,
      "lb": 0.45359237
    },
    "Time": {
      "s": 1,
      "min": 60,
      "hr": 3600
    },
    "Velocity": {
      "m/s": 1,
      "cm/s": 0.01,
      "mm/s": 1e-3,
      "km/hr": 0.2777777777777778,
      "ft/s": 0.3048
    },
    "Mass Flow Rate": {
      "kg/s": 1,
      "kg/min": 0.016666666666666666,
      "kg/hr": 2777777777777778e-19,
      "g/s": 1e-3
    },
    "Volumetric Flow Rate": {
      "m^3/s": 1,
      "m^3/hr": 2777777777777778e-19,
      "L/s": 1e-3,
      "L/min": 16666666666666667e-21
    },
    "Energy": {
      "J": 1,
      "kJ": 1e3,
      "MJ": 1e6,
      "cal": 4.184,
      "kcal": 4184,
      "Wh": 3600,
      "kWh": 36e5
    },
    "Power": {
      "W": 1,
      "kW": 1e3,
      "MW": 1e6,
      "hp": 745.699872
    },
    "Specific Heat": {
      "J/kg.K": 1,
      "kJ/kg.K": 1e3,
      "J/g.K": 1e3,
      "cal/g.K": 4184
    },
    "Thermal Conductivity": {
      "W/m.K": 1,
      "kW/m.K": 1e3,
      "W/cm.K": 100
    },
    "Dynamic Viscosity": {
      "Pa.s": 1,
      "cP": 1e-3,
      "kg/m.s": 1
    },
    "Density": {
      "kg/m^3": 1,
      "g/cm^3": 1e3,
      "kg/L": 1e3
    }
  };
  var temperatureScales = {
    C: { kelvin: (value2) => value2 + 273.15, fromKelvin: (value2) => value2 - 273.15 },
    K: { kelvin: (value2) => value2, fromKelvin: (value2) => value2 },
    F: {
      kelvin: (value2) => (value2 - 32) * 5 / 9 + 273.15,
      fromKelvin: (value2) => (value2 - 273.15) * 9 / 5 + 32
    }
  };
  function convertUnits(group, input, output, value2) {
    const units = unitGroups[group];
    if (!units || !Object.hasOwn(units, input) || !Object.hasOwn(units, output)) {
      throw new Error("Select a quantity and valid units.");
    }
    if (!Number.isFinite(value2)) throw new Error("Enter a finite input value.");
    if (input === output) return value2;
    const result = group === "Temperature" ? temperatureScales[output].fromKelvin(temperatureScales[input].kelvin(value2)) : value2 * (units[input] / units[output]);
    if (!Number.isFinite(result)) throw new Error("The converted value exceeds the numerical range.");
    return result;
  }

  // src/shared/dom.mjs
  function readNumber(input) {
    return input.value.trim() === "" ? NaN : Number(input.value);
  }
  function formatNumber(value2) {
    return String(Number(value2.toPrecision(10)));
  }
  function setStatus(element, message = "", isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  // src/shared/history.mjs
  var databaseName = "aditusan-calculation-history";
  var database;
  function openDatabase() {
    database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const records = db.createObjectStore("records", { keyPath: "id", autoIncrement: true });
        records.createIndex("scope", "scope");
        db.createObjectStore("snapshots");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Calculation history storage is blocked."));
    });
    return database;
  }
  function resultOf(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function changeHistory(scope, update) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["records", "snapshots"], "readwrite");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error ?? new Error("History storage is unavailable."));
      const records = transaction.objectStore("records");
      const snapshots = transaction.objectStore("snapshots");
      const matches = records.index("scope").getAll(scope);
      matches.onsuccess = () => update(matches.result, records, snapshots);
    });
  }
  function createHistory(id, { label = "Restore", action, limit = 20 } = {}) {
    const panel = document.getElementById(id);
    const list = panel.querySelector(".history-list");
    const empty = panel.querySelector(".history-empty");
    const clear = panel.querySelector(".history-clear");
    const note = panel.querySelector(".history-message");
    const scope = location.pathname.replace(/index\.html$/, "").replace(/\/?$/, "/") + "#" + id;
    const byteLimit = 96 * 1024 * 1024;
    let pending = Promise.resolve();
    let temporary;
    function render(entries) {
      list.replaceChildren();
      empty.hidden = entries.length > 0;
      clear.disabled = entries.length === 0;
      for (const entry of entries) {
        const row = document.createElement("li");
        const description = document.createElement("span");
        description.textContent = entry.summary;
        const when = document.createElement("small");
        when.className = "history-time";
        when.textContent = new Date(entry.time).toLocaleString(void 0, { dateStyle: "short", timeStyle: "short" });
        description.append(when);
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("aria-label", label + " " + entry.summary);
        button.addEventListener("click", async () => {
          try {
            const snapshot = entry.id === null ? structuredClone(temporary.snapshot) : await resultOf((await openDatabase()).transaction("snapshots").objectStore("snapshots").get(entry.id));
            if (!snapshot) throw new Error("That calculation was cleared.");
            await action(snapshot);
          } catch (error) {
            note.textContent = error.message;
          }
        });
        row.append(description, button);
        list.append(row);
      }
    }
    async function refresh() {
      let entries = [];
      try {
        const db = await openDatabase();
        entries = await resultOf(db.transaction("records").objectStore("records").index("scope").getAll(scope));
      } catch {
        note.textContent = "Saved history is unavailable in this browser.";
      }
      entries.reverse();
      if (temporary) entries.unshift(temporary.record);
      render(entries);
    }
    clear.addEventListener("click", () => {
      pending = pending.then(async () => {
        try {
          await changeHistory(scope, (entries, records, snapshots) => {
            for (const entry of entries) {
              records.delete(entry.id);
              snapshots.delete(entry.id);
            }
          });
          temporary = void 0;
          note.textContent = "History cleared.";
        } catch {
          if (temporary) {
            temporary = void 0;
            note.textContent = "Temporary history cleared.";
          } else {
            note.textContent = "The browser could not clear saved history.";
          }
        }
        await refresh();
      });
    });
    pending = refresh();
    return {
      add(summary, snapshot, bytes = 0) {
        const record = { scope, summary, time: Date.now(), bytes };
        pending = pending.then(async () => {
          try {
            await changeHistory(scope, (entries, records, snapshots) => {
              let keep = 1;
              let usedBytes = bytes;
              for (const entry of entries.reverse()) {
                if (keep >= limit || usedBytes + entry.bytes > byteLimit) {
                  records.delete(entry.id);
                  snapshots.delete(entry.id);
                } else {
                  keep++;
                  usedBytes += entry.bytes;
                }
              }
              const insert = records.add(record);
              insert.onsuccess = () => snapshots.add(snapshot, insert.result);
            });
            temporary = void 0;
            note.textContent = "";
          } catch {
            temporary = { record: { ...record, id: null }, snapshot };
            note.textContent = "The browser could not save this run. It is available until you close or reload this page.";
          }
          await refresh();
        });
      }
    };
  }

  // src/adi/unit-converter.mjs
  var form = document.querySelector("#unit-form");
  var status = document.querySelector("#unit-status");
  var { quantity, from, to, value, converted } = form.elements;
  var history = createHistory("unit-history", {
    label: "Copy",
    action(saved) {
      quantity.value = saved.quantity;
      updateUnits();
      from.value = saved.from;
      to.value = saved.to;
      value.value = saved.value;
      converted.value = saved.output;
      return copy(saved.output);
    }
  });
  function updateUnits() {
    const input = from.value;
    const output = to.value;
    const units = Object.keys(unitGroups[quantity.value]);
    from.replaceChildren(...units.map((unit) => new Option(unit, unit)));
    to.replaceChildren(...units.map((unit) => new Option(unit, unit)));
    from.value = units.includes(input) ? input : units[0];
    to.value = units.includes(output) ? output : units[1];
    converted.value = "";
    setStatus(status);
  }
  async function copy(valueToCopy) {
    try {
      await navigator.clipboard.writeText(valueToCopy);
      setStatus(status, "Copied to clipboard.");
    } catch {
      setStatus(status, "Clipboard access is unavailable. Select and copy the output value.");
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const inputValue = readNumber(value);
      const result = formatNumber(convertUnits(quantity.value, from.value, to.value, inputValue));
      converted.value = result;
      const summary = quantity.value + " · " + formatNumber(inputValue) + " " + from.value + " = " + result + " " + to.value;
      history.add(summary, {
        quantity: quantity.value,
        from: from.value,
        to: to.value,
        value: value.value,
        output: result
      });
      copy(result);
    } catch (error) {
      converted.value = "";
      setStatus(status, error.message, true);
    }
  });
  quantity.addEventListener("change", updateUnits);
  form.addEventListener("calculator-reset", () => {
    quantity.selectedIndex = 0;
    value.value = "";
    from.replaceChildren();
    to.replaceChildren();
    updateUnits();
  });
  for (const control of [from, to, value]) {
    control.addEventListener("input", () => {
      converted.value = "";
      setStatus(status);
    });
  }
  updateUnits();
})();
