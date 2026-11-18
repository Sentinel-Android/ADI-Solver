(() => {
  // src/adi/adi-engine.mjs
  var coefficientKeys = ["a", "b", "c", "d", "e", "f", "g", "h", "u0"];
  var maxValues = 5e5;
  var maxVariables = 32;
  function validateGrid(nx, ny, m) {
    if (![nx, ny, m].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error("Nx, Ny, and m must be positive integers.");
    }
    if (m > maxVariables || nx * ny * m > maxValues) {
      throw new Error("Use up to 32 variables per node and 500,000 node-variable rows.");
    }
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

  // src/adi/solver.mjs
  var solverScript = document.currentScript.src;
  var get = (id) => document.getElementById(id);
  var setup = get("adi-setup");
  var status = get("adi-status");
  var inputBody = get("node-body");
  var solutionBody = get("solution-body");
  var nodeMap = get("node-map");
  var kField = get("node-k");
  var iField = get("node-i");
  var jField = get("node-j");
  var progress = get("solve-progress");
  var cancel = get("cancel-solve");
  var controls = ["setup-controls", "node-nav", "node-entries", "coupling-controls"].map(get);
  var tabs = [...document.querySelectorAll("[role=tab]")];
  var inputPageSize = 48;
  var solutionPageSize = 100;
  var history = createHistory("solver-history", { action: restore, limit: 10 });
  var grid;
  var coefficients;
  var coupling;
  var selected = { i: 0, j: 0 };
  var inputPage = 0;
  var solutionPage = 0;
  var solution = null;
  var worker = null;
  var localWorkerUrl = null;
  var invalidCells = /* @__PURE__ */ new Map();
  var displayKey = (key) => key === "u0" ? "U0" : key;
  var coords = (index) => [
    Math.floor(index / (grid.ny * grid.m)),
    Math.floor(index / grid.m) % grid.ny,
    index % grid.m
  ];
  var nodeLabel = (index) => "(" + coords(index).join(", ") + ")";
  var rowIndex = (i, j, k) => (i * grid.ny + j) * grid.m + k;
  var cellId = (key, index) => "cell-" + key + "-" + index;
  function selectTab(name, focus = false) {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", active);
      tab.tabIndex = active ? 0 : -1;
      get(tab.getAttribute("aria-controls")).hidden = !active;
      if (active && focus) tab.focus();
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let target = (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = tabs.length - 1;
      selectTab(tabs[target].dataset.tab, true);
    });
  }
  function numberField(id, label, value) {
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", label);
    input.value = value;
    if (invalidCells.has(id)) input.setAttribute("aria-invalid", "true");
    return input;
  }
  function recordCell(event, array, index) {
    const input = event.currentTarget;
    const text = input.value.trim();
    const value = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
    if (Number.isFinite(value)) {
      array[index] = value;
      invalidCells.delete(input.id);
      input.removeAttribute("aria-invalid");
    } else {
      invalidCells.set(input.id, input.value);
      input.setAttribute("aria-invalid", "true");
    }
    clearSolution();
    setStatus(status);
  }
  function updatePager(name, page, size, total) {
    const first = page * size;
    const end = Math.min(first + size, total);
    get(name + "-page").textContent = total ? first + 1 + "–" + end + " of " + total : "0 rows";
    get(name + "-prev").disabled = first === 0;
    get(name + "-next").disabled = end >= total;
    return [first, end];
  }
  function renderInputs() {
    const [start, end] = updatePager("input", inputPage, inputPageSize, grid.size);
    get("node-empty").hidden = true;
    get("input-table").hidden = false;
    get("input-pager").hidden = false;
    inputBody.replaceChildren();
    for (let index = start; index < end; index++) {
      const row = inputBody.insertRow();
      const heading = document.createElement("th");
      heading.scope = "row";
      const node = nodeLabel(index);
      heading.textContent = node;
      row.append(heading);
      for (const key of coefficientKeys) {
        const id = cellId(key, index);
        const input = numberField(
          id,
          displayKey(key) + " at " + node,
          invalidCells.get(id) ?? String(coefficients[key][index])
        );
        input.addEventListener("input", (event) => recordCell(event, coefficients[key], index));
        row.insertCell().append(input);
      }
    }
  }
  function renderSolution() {
    const [start, end] = updatePager("solution", solutionPage, solutionPageSize, solution?.length ?? 0);
    solutionBody.replaceChildren();
    get("solution-empty").hidden = solution !== null;
    get("solution-table").hidden = solution === null;
    get("solution-pager").hidden = solution === null;
    for (let i = start; i < end; i++) makeTableRow(solutionBody, [nodeLabel(i), formatNumber(solution[i])]);
  }
  function clearSolution() {
    if (solution === null) return;
    solution = null;
    solutionPage = 0;
    renderSolution();
  }
  for (const [name, adjustPage, render] of [
    ["input", (change) => {
      inputPage += change;
    }, renderInputs],
    ["solution", (change) => {
      solutionPage += change;
    }, renderSolution]
  ]) {
    for (const [direction, change] of [["prev", -1], ["next", 1]]) {
      get(name + "-" + direction).addEventListener("click", () => {
        adjustPage(change);
        render();
        get(name + "-table").scrollTop = 0;
      });
    }
  }
  function renderCoupling() {
    const table = get("coupling-table");
    table.replaceChildren();
    const headRow = table.createTHead().insertRow();
    for (let col = -1; col < grid.m; col++) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = col < 0 ? "k / ℓ" : String(col);
      headRow.append(th);
    }
    const body = table.createTBody();
    for (let row = 0; row < grid.m; row++) {
      const tr = body.insertRow();
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = row;
      tr.append(th);
      for (let col = 0; col < grid.m; col++) {
        const index = row * grid.m + col;
        const id = "coupling-" + index;
        const input = numberField(id, "G at row " + row + ", column " + col, String(coupling[index]));
        input.addEventListener("input", (event) => recordCell(event, coupling, index));
        tr.insertCell().append(input);
      }
    }
  }
  function validCoordinate(field, limit) {
    const value = readNumber(field);
    if (!Number.isSafeInteger(value) || value < 0 || value >= limit) {
      throw new Error("The " + field.dataset.coordinate + " coordinate must be an integer from 0 to " + (limit - 1) + ".");
    }
    return value;
  }
  function updateNodeLabel() {
    const k = readNumber(kField);
    const valid = Number.isSafeInteger(k) && k >= 0 && k < grid.m;
    get("selected-node").textContent = "(" + selected.i + ", " + selected.j + ", " + (valid ? k : "–") + ")";
  }
  function selectNode(i, j, focus = false) {
    selected = { i, j };
    iField.value = i;
    jField.value = j;
    const snapshot = document.createDocumentFragment();
    const visible = 5;
    const iStart = Math.max(0, Math.min(i - 2, grid.nx - visible));
    const jStart = Math.max(0, Math.min(j - 2, grid.ny - visible));
    const columnCount = Math.min(grid.ny, visible);
    nodeMap.style.gridTemplateColumns = "repeat(" + columnCount + ", minmax(0, 1fr))";
    let selectedButton;
    for (let ix = iStart; ix < Math.min(grid.nx, iStart + visible); ix++) {
      for (let jy = jStart; jy < Math.min(grid.ny, jStart + visible); jy++) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = ix + "," + jy;
        button.title = "Select node (" + ix + ", " + jy + ")";
        button.setAttribute("aria-pressed", ix === i && jy === j);
        if (ix === i && jy === j) selectedButton = button;
        button.addEventListener("click", () => selectNode(ix, jy, true));
        snapshot.append(button);
      }
    }
    nodeMap.replaceChildren(snapshot);
    updateNodeLabel();
    if (focus) selectedButton.focus();
  }
  function focusCoefficient(key) {
    const k = validCoordinate(kField, grid.m);
    const index = rowIndex(selected.i, selected.j, k);
    inputPage = Math.floor(index / inputPageSize);
    selectTab("inputs");
    renderInputs();
    const cell = get(cellId(key, index));
    cell.focus();
    cell.select();
  }
  get("jump-node").addEventListener("click", () => {
    try {
      selectNode(validCoordinate(iField, grid.nx), validCoordinate(jField, grid.ny));
      setStatus(status);
    } catch (error) {
      setStatus(status, error.message, true);
    }
  });
  kField.addEventListener("input", updateNodeLabel);
  for (const button of document.querySelectorAll("[data-coeff]")) {
    button.addEventListener("click", () => {
      try {
        focusCoefficient(button.dataset.coeff);
      } catch (error) {
        setStatus(status, error.message, true);
      }
    });
  }
  function getGrid() {
    const nx = readNumber(setup.elements.nx);
    const ny = readNumber(setup.elements.ny);
    const m = readNumber(setup.elements.m);
    validateGrid(nx, ny, m);
    return { nx, ny, m, size: nx * ny * m };
  }
  function createGrid(example = false) {
    const newGrid = getGrid();
    const newCoefficients = Object.fromEntries(coefficientKeys.map((key) => [key, new Float64Array(newGrid.size)]));
    const newCoupling = new Float64Array(newGrid.m * newGrid.m);
    if (example) {
      const center = 4;
      for (const key of ["a", "c", "e", "g"]) newCoefficients[key][center] = 1;
      for (const key of ["b", "f"]) newCoefficients[key][center] = -2;
      newCoefficients.u0.set([100, 100, 100, 100, 0, 100, 100, 100, 100]);
    }
    installGrid(newGrid, newCoefficients, newCoupling);
    selectTab("inputs");
    setStatus(status, example ? "Loaded the 3 × 3 heat diffusion example." : "Created " + grid.size + " node-variable rows.");
  }
  function installGrid(dimensions, newCoefficients, newCoupling) {
    grid = dimensions;
    coefficients = newCoefficients;
    coupling = newCoupling;
    invalidCells.clear();
    inputPage = 0;
    kField.max = grid.m - 1;
    iField.max = grid.nx - 1;
    jField.max = grid.ny - 1;
    kField.value = 0;
    selectNode(0, 0);
    renderInputs();
    renderCoupling();
    get("coupling-details").hidden = false;
    clearSolution();
    setBusy(false);
  }
  function showSolution(values) {
    solution = values;
    solutionPage = 0;
    renderSolution();
    selectTab("solution", true);
  }
  function restore({ problem, values }) {
    if (worker) throw new Error("Cancel the running calculation before restoring a previous run.");
    const { nx, ny, m, size, coefficients: savedCoefficients, coupling: savedCoupling, ...settings } = problem;
    for (const [key, value] of Object.entries({ nx, ny, m, ...settings })) setup.elements[key].value = value;
    installGrid({ nx, ny, m, size }, savedCoefficients, savedCoupling);
    showSolution(values);
    setStatus(status, "Restored inputs and solution.");
  }
  get("create-nodes").addEventListener("click", () => {
    try {
      createGrid();
    } catch (error) {
      setStatus(status, error.message, true);
    }
  });
  get("zero-nodes").addEventListener("click", () => {
    for (const key of coefficientKeys) coefficients[key].fill(0);
    for (const id of invalidCells.keys()) {
      if (id.startsWith("cell-")) invalidCells.delete(id);
    }
    clearSolution();
    renderInputs();
    selectTab("inputs");
    setStatus(status, "Set all node values to zero.");
  });
  get("load-example").addEventListener("click", () => {
    for (const [key, value] of Object.entries({ nx: 3, ny: 3, m: 1, dx: 1, dy: 1, nt: 10, dt: 0.1, boundary: "fixed" })) {
      setup.elements[key].value = value;
    }
    createGrid(true);
  });
  get("reset-solver").addEventListener("click", () => {
    setup.reset();
    for (const name of ["nx", "ny", "m", "dx", "dy", "dt", "nt"]) setup.elements[name].value = "";
    grid = null;
    coefficients = null;
    coupling = null;
    invalidCells.clear();
    inputPage = 0;
    for (const field of [iField, jField, kField]) field.value = "";
    get("selected-node").textContent = "—";
    nodeMap.replaceChildren();
    inputBody.replaceChildren();
    get("node-empty").hidden = false;
    get("input-table").hidden = true;
    get("input-pager").hidden = true;
    get("coupling-table").replaceChildren();
    get("coupling-details").open = false;
    get("coupling-details").hidden = true;
    updatePager("input", 0, inputPageSize, 0);
    clearSolution();
    selectTab("inputs");
    setBusy(false);
    get("unit-form").dispatchEvent(new Event("calculator-reset"));
    setStatus(status, "Inputs and solution cleared.");
  });
  setup.addEventListener("input", () => {
    clearSolution();
    setStatus(status);
  });
  function getProblem() {
    const next = getGrid();
    if (!grid || grid.nx !== next.nx || grid.ny !== next.ny || grid.m !== next.m) {
      throw new Error("Create the node table after changing Nx, Ny, or m.");
    }
    const { dx, dy, dt, nt, boundary } = setup.elements;
    const numbers = { dx: readNumber(dx), dy: readNumber(dy), dt: readNumber(dt), nt: readNumber(nt) };
    if (![numbers.dx, numbers.dy, numbers.dt].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("Enter positive values for dx, dy, and dt.");
    }
    if (!Number.isSafeInteger(numbers.nt) || numbers.nt < 1) throw new Error("Enter a positive integer for Nt.");
    if (invalidCells.size) {
      const id = invalidCells.keys().next().value;
      if (id.startsWith("cell-")) {
        const [, key, index] = id.split("-");
        const [i, j, k] = coords(Number(index));
        kField.value = k;
        selectNode(i, j);
        focusCoefficient(key);
        throw new Error("Enter a finite number in " + displayKey(key) + " at " + nodeLabel(Number(index)) + ".");
      }
      const cell = get(id);
      cell.closest("details").open = true;
      cell.focus();
      throw new Error("Enter a finite number for " + cell.getAttribute("aria-label") + ".");
    }
    return { ...grid, ...numbers, coefficients, coupling, boundary: boundary.value };
  }
  function setBusy(busy) {
    controls[0].disabled = busy;
    for (const control of controls.slice(1)) control.disabled = busy || !grid;
    get("zero-nodes").disabled = !grid;
    progress.hidden = !busy;
    cancel.hidden = !busy;
  }
  function finish() {
    worker?.terminate();
    worker = null;
    if (localWorkerUrl) {
      URL.revokeObjectURL(localWorkerUrl);
      localWorkerUrl = null;
    }
    setBusy(false);
  }
  function createWorker() {
    if (location.protocol !== "file:") return new Worker(new URL("adi-worker.js", solverScript));
    localWorkerUrl = URL.createObjectURL(new Blob(['(() => {\n  // src/adi/adi-engine.mjs\n  var coefficientKeys = ["a", "b", "c", "d", "e", "f", "g", "h", "u0"];\n  var maxValues = 5e5;\n  var maxVariables = 32;\n  function validateGrid(nx, ny, m) {\n    if (![nx, ny, m].every((value) => Number.isSafeInteger(value) && value > 0)) {\n      throw new Error("Nx, Ny, and m must be positive integers.");\n    }\n    if (m > maxVariables || nx * ny * m > maxValues) {\n      throw new Error("Use up to 32 variables per node and 500,000 node-variable rows.");\n    }\n  }\n  function validateProblem({ nx, ny, m, dx, dy, dt, nt, coefficients, coupling, boundary }) {\n    validateGrid(nx, ny, m);\n    if (![dx, dy, dt].every((value) => Number.isFinite(value) && value > 0)) {\n      throw new Error("dx, dy, and dt must be positive, finite numbers.");\n    }\n    if (!Number.isSafeInteger(nt) || nt < 1) throw new Error("Nt must be a positive integer.");\n    const size = nx * ny * m;\n    for (const key of coefficientKeys) {\n      if (coefficients[key]?.length !== size || !coefficients[key].every(Number.isFinite)) {\n        throw new Error("Enter a finite value for every " + (key === "u0" ? "U0" : key) + " field.");\n      }\n    }\n    if (coupling.length !== m * m || !coupling.every(Number.isFinite)) {\n      throw new Error("G must be an m × m matrix with finite entries.");\n    }\n    if (boundary !== "fixed" && boundary !== "desktop") throw new Error("Choose a boundary convention.");\n  }\n  function scalarSweep(axis, explicit, input, output, weights, source, upper, rhs, fixed) {\n    const { m, extent, lineCount, stride, lineStride, low, high, center, scale } = axis;\n    const otherStride = explicit.stride;\n    for (let line = 1; line <= lineCount; line++) {\n      const edge = line * lineStride;\n      for (let k = 0; k < m; k++) {\n        let previousUpper = 0;\n        let previousRhs = 0;\n        const local = weights[k * m + k];\n        for (let node = 0; node < extent; node++) {\n          const i = edge + (node + 1) * stride + k;\n          const a = -scale * low[i];\n          const c = -scale * high[i];\n          let d = input[i] + local * input[i] + source[i] + explicit.scale * (explicit.low[i] * input[i - otherStride] + explicit.center[i] * input[i] + explicit.high[i] * input[i + otherStride]);\n          if (fixed && node === 0) d -= a * input[i - stride];\n          if (fixed && node === extent - 1) d -= c * input[i + stride];\n          const pivot = 1 - scale * center[i] - local - a * previousUpper;\n          if (!Number.isFinite(pivot) || pivot === 0) {\n            throw new Error("The " + axis.name + " sweep has a singular or non-finite pivot.");\n          }\n          previousUpper = node === extent - 1 ? 0 : c / pivot;\n          previousRhs = (d - a * previousRhs) / pivot;\n          upper[node] = previousUpper;\n          rhs[node] = previousRhs;\n        }\n        let next = 0;\n        for (let node = extent - 1; node >= 0; node--) {\n          const i = edge + (node + 1) * stride + k;\n          next = rhs[node] - upper[node] * next;\n          if (!Number.isFinite(next)) throw new Error("The " + axis.name + " sweep produced a non-finite value.");\n          output[i] = next;\n        }\n      }\n    }\n  }\n  function solveBlock(augmented, m, width) {\n    for (let col = 0; col < m; col++) {\n      let pivot = col;\n      for (let row = col + 1; row < m; row++) {\n        if (Math.abs(augmented[row * width + col]) > Math.abs(augmented[pivot * width + col])) pivot = row;\n      }\n      if (pivot !== col) {\n        for (let j = col; j < width; j++) {\n          const offset = col * width + j;\n          const swap = pivot * width + j;\n          const value = augmented[offset];\n          augmented[offset] = augmented[swap];\n          augmented[swap] = value;\n        }\n      }\n      const rowStart = col * width;\n      const divisor = augmented[rowStart + col];\n      if (!Number.isFinite(divisor) || divisor === 0) throw new Error("A coupling block has a singular or non-finite pivot.");\n      for (let j = col + 1; j < width; j++) augmented[rowStart + j] /= divisor;\n      for (let row = col + 1; row < m; row++) {\n        const rowOffset = row * width;\n        const factor = augmented[rowOffset + col];\n        for (let j = col + 1; j < width; j++) augmented[rowOffset + j] -= factor * augmented[rowStart + j];\n      }\n    }\n    for (let col = m - 1; col > 0; col--) {\n      for (let row = 0; row < col; row++) {\n        const offset = row * width;\n        const factor = augmented[offset + col];\n        for (let j = m; j < width; j++) augmented[offset + j] -= factor * augmented[col * width + j];\n      }\n    }\n  }\n  function blockSweep(axis, explicit, input, output, weights, source, upper, rhs, augmented, fixed) {\n    const { m, extent, lineCount, stride, lineStride, low, high, center, scale } = axis;\n    const otherStride = explicit.stride;\n    const square = m * m;\n    const width = 2 * m + 1;\n    for (let line = 1; line <= lineCount; line++) {\n      const edge = line * lineStride;\n      for (let node = 0; node < extent; node++) {\n        const base = edge + (node + 1) * stride;\n        const blockOffset = node * square;\n        const rhsOffset = node * m;\n        for (let row = 0; row < m; row++) {\n          const i = base + row;\n          const a = -scale * low[i];\n          const c = -scale * high[i];\n          const rowOffset = row * width;\n          let d = input[i] + source[i] + explicit.scale * (explicit.low[i] * input[i - otherStride] + explicit.center[i] * input[i] + explicit.high[i] * input[i + otherStride]);\n          for (let col = 0; col < m; col++) {\n            const weight = weights[row * m + col];\n            const previous = node === 0 ? 0 : a * upper[blockOffset - square + row * m + col];\n            augmented[rowOffset + col] = (row === col ? 1 - scale * center[i] : 0) - weight - previous;\n            augmented[rowOffset + m + col] = row === col && node < extent - 1 ? c : 0;\n            d += weight * input[base + col];\n          }\n          if (node > 0) d -= a * rhs[rhsOffset - m + row];\n          if (fixed && node === 0) d -= a * input[i - stride];\n          if (fixed && node === extent - 1) d -= c * input[i + stride];\n          augmented[rowOffset + width - 1] = d;\n        }\n        solveBlock(augmented, m, width);\n        for (let row = 0; row < m; row++) {\n          const rowOffset = row * width;\n          for (let col = 0; col < m; col++) {\n            upper[blockOffset + row * m + col] = augmented[rowOffset + m + col];\n          }\n          rhs[rhsOffset + row] = augmented[rowOffset + width - 1];\n        }\n      }\n      for (let node = extent - 1; node >= 0; node--) {\n        const base = edge + (node + 1) * stride;\n        for (let row = 0; row < m; row++) {\n          let value = rhs[node * m + row];\n          if (node < extent - 1) {\n            const offset = node * square + row * m;\n            for (let col = 0; col < m; col++) value -= upper[offset + col] * output[base + stride + col];\n          }\n          if (!Number.isFinite(value)) throw new Error("The " + axis.name + " sweep produced a non-finite value.");\n          output[base + row] = value;\n        }\n      }\n    }\n  }\n  function solveADI(problem, onStep = () => {\n  }) {\n    validateProblem(problem);\n    const { nx, ny, m, dx, dy, dt, nt, coefficients, coupling, boundary } = problem;\n    const { a, b, c, d, e, f, g, h, u0 } = coefficients;\n    const solution = u0.slice();\n    if (nx < 3 || ny < 3) {\n      onStep(nt);\n      return solution;\n    }\n    const scaleX = dt / 2 / dx;\n    const scaleY = dt / 2 / dy;\n    const x = {\n      name: "x",\n      extent: nx - 2,\n      lineCount: ny - 2,\n      stride: ny * m,\n      lineStride: m,\n      low: c,\n      high: a,\n      center: b,\n      scale: scaleX,\n      m\n    };\n    const y = {\n      name: "y",\n      extent: ny - 2,\n      lineCount: nx - 2,\n      stride: m,\n      lineStride: ny * m,\n      low: g,\n      high: e,\n      center: f,\n      scale: scaleY,\n      m\n    };\n    const halfStep = solution.slice();\n    const source = Float64Array.from(d, (value, index) => scaleX * value + scaleY * h[index]);\n    const weights = Float64Array.from(coupling, (value) => dt / 4 * value);\n    const hasCrossCoupling = coupling.some((value, index) => index % (m + 1) !== 0 && value !== 0);\n    const lineLength = Math.max(x.extent, y.extent);\n    const upper = new Float64Array(lineLength * (hasCrossCoupling ? m * m : 1));\n    const rhs = new Float64Array(lineLength * (hasCrossCoupling ? m : 1));\n    const augmented = hasCrossCoupling ? new Float64Array(m * (2 * m + 1)) : null;\n    const fixed = boundary === "fixed";\n    for (let step = 1; step <= nt; step++) {\n      try {\n        if (hasCrossCoupling) {\n          blockSweep(x, y, solution, halfStep, weights, source, upper, rhs, augmented, fixed);\n          blockSweep(y, x, halfStep, solution, weights, source, upper, rhs, augmented, fixed);\n        } else {\n          scalarSweep(x, y, solution, halfStep, weights, source, upper, rhs, fixed);\n          scalarSweep(y, x, halfStep, solution, weights, source, upper, rhs, fixed);\n        }\n      } catch (error) {\n        throw new Error("Step " + step + ". " + error.message);\n      }\n      onStep(step);\n    }\n    return solution;\n  }\n\n  // src/adi/adi-worker.mjs\n  self.onmessage = ({ data }) => {\n    const start = performance.now();\n    let lastUpdate = start;\n    try {\n      const values = solveADI(data, (step) => {\n        const now = performance.now();\n        if (now - lastUpdate >= 120 && step < data.nt) {\n          self.postMessage({ type: "progress", step });\n          lastUpdate = now;\n        }\n      });\n      const inputBuffers = Object.values(data.coefficients).map((array) => array.buffer);\n      self.postMessage(\n        { type: "result", values, problem: data, elapsed: performance.now() - start },\n        [values.buffer, data.coupling.buffer, ...inputBuffers]\n      );\n    } catch (error) {\n      self.postMessage({ type: "error", message: error.message });\n    }\n  };\n})();\n'], { type: "text/javascript" }));
    return new Worker(localWorkerUrl);
  }
  function solve() {
    if (worker) return;
    try {
      const problem = getProblem();
      clearSolution();
      const running = createWorker();
      worker = running;
      running.onmessage = ({ data }) => {
        if (worker !== running) return;
        if (data.type === "progress") {
          progress.value = data.step;
          setStatus(status, "Running step " + data.step + " of " + problem.nt + ".");
          return;
        }
        finish();
        if (data.type === "error") {
          setStatus(status, data.message, true);
          return;
        }
        showSolution(data.values);
        setStatus(status, "Solved " + problem.nt + " time steps in " + (data.elapsed / 1e3).toFixed(3) + " s.");
        const summary = problem.nx + " × " + problem.ny + " grid · " + problem.m + (problem.m === 1 ? " variable · " : " variables · ") + problem.nt + " steps";
        const bytes = problem.size * 10 * Float64Array.BYTES_PER_ELEMENT + data.problem.coupling.byteLength;
        history.add(summary, { problem: data.problem, values: data.values }, bytes);
      };
      running.onerror = () => {
        if (worker !== running) return;
        finish();
        setStatus(status, "The background solver could not start. Try the published site or a local HTTP preview with Web Workers enabled.", true);
      };
      progress.max = problem.nt;
      progress.value = 0;
      setBusy(true);
      setStatus(status, "Solving " + problem.nt + " time steps.");
      running.postMessage(problem);
    } catch (error) {
      finish();
      setStatus(status, error.message, true);
    }
  }
  setup.addEventListener("submit", (event) => {
    event.preventDefault();
    solve();
  });
  cancel.addEventListener("click", () => {
    finish();
    get("solve").focus();
    setStatus(status, "Calculation canceled.");
  });
  renderSolution();
})();
