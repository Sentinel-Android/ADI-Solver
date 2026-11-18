(() => {
  // src/adi/adi-engine.mjs
  function solveHeat1D({ values, alpha, dx, dt, nt, implicit }) {
    if (values.length < 3 || values.length > 500 || !values.every(Number.isFinite)) {
      throw new Error("Enter between 3 and 500 finite initial values.");
    }
    if (![alpha, dx, dt].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("Diffusivity, spacing, and step size must be positive.");
    }
    if (!Number.isSafeInteger(nt) || nt < 1 || nt > 1e4) {
      throw new Error("Enter 1 to 10,000 time steps.");
    }
    const r = alpha / dx * (dt / dx);
    if (!Number.isFinite(r) || 1 + 2 * r === Infinity) throw new Error("The diffusion number is too large.");
    if (!implicit && r > 0.5) {
      throw new Error("The diffusion number r is " + r.toPrecision(5) + ". For this explicit method use r ≤ 0.5.");
    }
    const lowerEdge = values[0];
    const upperEdge = values.at(-1);
    const work = new Float64Array(values.length);
    const upper = new Float64Array(values.length);
    const diagonal = new Float64Array(values.length);
    let current = Float64Array.from(values);
    let next = current.slice();
    if (implicit) {
      for (let i = 1; i < values.length - 1; i++) {
        diagonal[i] = 1 + 2 * r + r * upper[i - 1];
        upper[i] = -r / diagonal[i];
      }
    }
    for (let step = 0; step < nt; step++) {
      if (implicit) {
        for (let i = 1; i < values.length - 1; i++) {
          let rhs = current[i];
          if (i === 1) rhs += r * lowerEdge;
          if (i === values.length - 2) rhs += r * upperEdge;
          work[i] = rhs / diagonal[i] + r / diagonal[i] * work[i - 1];
        }
        next.set(current);
        let followingInterior = 0;
        for (let i = values.length - 2; i >= 1; i--) {
          next[i] = work[i] - upper[i] * followingInterior;
          followingInterior = next[i];
        }
      } else {
        for (let i = 1; i < values.length - 1; i++) {
          next[i] = (1 - 2 * r) * current[i] + r * current[i - 1] + r * current[i + 1];
        }
      }
      [current, next] = [next, current];
    }
    if (!current.every(Number.isFinite)) throw new Error("The result exceeded the numerical range.");
    return { r, values: current };
  }

  // src/shared/dom.mjs
  function readNumber(input) {
    return input.value.trim() === "" ? NaN : Number(input.value);
  }
  function formatNumber(value) {
    return String(Number(value.toPrecision(10)));
  }
  function setStatus(element, message = "", isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }
  function makeTableRow(body, values) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
    return row;
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
    const clear2 = panel.querySelector(".history-clear");
    const note = panel.querySelector(".history-message");
    const scope = location.pathname.replace(/index\.html$/, "").replace(/\/?$/, "/") + "#" + id;
    const byteLimit = 96 * 1024 * 1024;
    let pending = Promise.resolve();
    let temporary;
    function render(entries) {
      list.replaceChildren();
      empty.hidden = entries.length > 0;
      clear2.disabled = entries.length === 0;
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
    clear2.addEventListener("click", () => {
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

  // src/adi/heat-calculator.mjs
  var form = document.querySelector("#heat-form");
  var results = document.querySelector("#heat-results");
  var status = document.querySelector("#heat-status");
  var number = document.querySelector("#diffusion-number");
  function restore(saved) {
    for (const name of ["values", "alpha", "dx", "dt", "nt"]) form.elements[name].value = saved[name];
    calculate();
  }
  var history = createHistory("heat-history", { action: restore });
  function clear() {
    results.querySelector("tbody").replaceChildren();
    results.hidden = true;
    number.textContent = "—";
    setStatus(status);
  }
  function calculate(save = false) {
    clear();
    try {
      const { values, alpha, dx, dt, nt } = form.elements;
      const profile = values.value.trim().split(/[,\s]+/).filter(Boolean).map(Number);
      const result = solveHeat1D({
        values: profile,
        alpha: readNumber(alpha),
        dx: readNumber(dx),
        dt: readNumber(dt),
        nt: readNumber(nt),
        implicit: form.dataset.method === "implicit"
      });
      number.textContent = formatNumber(result.r);
      const body = results.querySelector("tbody");
      result.values.forEach((value, index) => makeTableRow(body, [index, formatNumber(profile[index]), formatNumber(value)]));
      results.hidden = false;
      setStatus(status, "Calculation complete.");
      if (save) {
        history.add(
          profile.length + " nodes · " + nt.value + " steps · r = " + formatNumber(result.r),
          { values: values.value, alpha: alpha.value, dx: dx.value, dt: dt.value, nt: nt.value, result }
        );
      }
    } catch (error) {
      setStatus(status, error.message, true);
    }
  }
  form.addEventListener("input", clear);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate(true);
  });
  var example = document.querySelector("#heat-example");
  example.addEventListener("click", () => restore(JSON.parse(example.dataset.example)));
})();
