import { solveHeat1D } from "./adi-engine.mjs";
import { formatNumber, makeTableRow, readNumber, setStatus } from "../shared/dom.mjs";
import { createHistory } from "../shared/history.mjs";

const form = document.querySelector("#heat-form");
const results = document.querySelector("#heat-results");
const status = document.querySelector("#heat-status");
const number = document.querySelector("#diffusion-number");
function restore(saved) {
  for (const name of ["values", "alpha", "dx", "dt", "nt"]) form.elements[name].value = saved[name];
  calculate();
}
const history = createHistory("heat-history", { action: restore });

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
      alpha: readNumber(alpha), dx: readNumber(dx), dt: readNumber(dt), nt: readNumber(nt),
      implicit: form.dataset.method === "implicit",
    });
    number.textContent = formatNumber(result.r);
    const body = results.querySelector("tbody");
    result.values.forEach((value, index) => makeTableRow(body, [index, formatNumber(profile[index]), formatNumber(value)]));
    results.hidden = false;
    setStatus(status, "Calculation complete.");
    if (save) {
      history.add(profile.length + " nodes · " + nt.value + " steps · r = " + formatNumber(result.r),
        { values: values.value, alpha: alpha.value, dx: dx.value, dt: dt.value, nt: nt.value, result });
    }
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

form.addEventListener("input", clear);
form.addEventListener("submit", event => {
  event.preventDefault();
  calculate(true);
});
const example = document.querySelector("#heat-example");
example.addEventListener("click", () => restore(JSON.parse(example.dataset.example)));
