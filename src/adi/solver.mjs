import { coefficientKeys, validateGrid } from "./adi-engine.mjs";
import { formatNumber, makeTableRow, readNumber, setStatus } from "../shared/dom.mjs";
import { createHistory } from "../shared/history.mjs";

const solverScript = document.currentScript.src;

const get = id => document.getElementById(id);
const setup = get("adi-setup");
const status = get("adi-status");
const inputBody = get("node-body");
const solutionBody = get("solution-body");
const nodeMap = get("node-map");
const kField = get("node-k");
const iField = get("node-i");
const jField = get("node-j");
const progress = get("solve-progress");
const cancel = get("cancel-solve");
const controls = ["setup-controls", "node-nav", "node-entries", "coupling-controls"].map(get);
const tabs = [...document.querySelectorAll("[role=tab]")];
const inputPageSize = 48;
const solutionPageSize = 100;
const history = createHistory("solver-history", { action: restore, limit: 10 });

let grid;
let coefficients;
let coupling;
let selected = { i: 0, j: 0 };
let inputPage = 0;
let solutionPage = 0;
let solution = null;
let worker = null;
let localWorkerUrl = null;
const invalidCells = new Map();

const displayKey = key => key === "u0" ? "U0" : key;
const coords = index => [
  Math.floor(index / (grid.ny * grid.m)),
  Math.floor(index / grid.m) % grid.ny,
  index % grid.m,
];
const nodeLabel = index => "(" + coords(index).join(", ") + ")";
const rowIndex = (i, j, k) => (i * grid.ny + j) * grid.m + k;
const cellId = (key, index) => "cell-" + key + "-" + index;

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
  tab.addEventListener("keydown", event => {
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
  get(name + "-page").textContent = total ? (first + 1) + "–" + end + " of " + total : "0 rows";
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
      const input = numberField(id, displayKey(key) + " at " + node,
        invalidCells.get(id) ?? String(coefficients[key][index]));
      input.addEventListener("input", event => recordCell(event, coefficients[key], index));
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
  ["input", change => { inputPage += change; }, renderInputs],
  ["solution", change => { solutionPage += change; }, renderSolution],
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
      input.addEventListener("input", event => recordCell(event, coupling, index));
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
  const newCoefficients = Object.fromEntries(coefficientKeys.map(key => [key, new Float64Array(newGrid.size)]));
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
  if (![numbers.dx, numbers.dy, numbers.dt].every(value => Number.isFinite(value) && value > 0)) {
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
  localWorkerUrl = URL.createObjectURL(new Blob([__ADI_LOCAL_WORKER_SOURCE__], { type: "text/javascript" }));
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
      setStatus(status, "Solved " + problem.nt + " time steps in " + (data.elapsed / 1000).toFixed(3) + " s.");
      const summary = problem.nx + " × " + problem.ny + " grid · " + problem.m
        + (problem.m === 1 ? " variable · " : " variables · ") + problem.nt + " steps";
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

setup.addEventListener("submit", event => {
  event.preventDefault();
  solve();
});
cancel.addEventListener("click", () => {
  finish();
  get("solve").focus();
  setStatus(status, "Calculation canceled.");
});
renderSolution();
