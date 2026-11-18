import { convertUnits, unitGroups } from "./units.mjs";
import { formatNumber, readNumber, setStatus } from "../shared/dom.mjs";
import { createHistory } from "../shared/history.mjs";

const form = document.querySelector("#unit-form");
const status = document.querySelector("#unit-status");
const { quantity, from, to, value, converted } = form.elements;
const history = createHistory("unit-history", {
  label: "Copy",
  action(saved) {
    quantity.value = saved.quantity;
    updateUnits();
    from.value = saved.from;
    to.value = saved.to;
    value.value = saved.value;
    converted.value = saved.output;
    return copy(saved.output);
  },
});

function updateUnits() {
  const input = from.value;
  const output = to.value;
  const units = Object.keys(unitGroups[quantity.value]);
  from.replaceChildren(...units.map(unit => new Option(unit, unit)));
  to.replaceChildren(...units.map(unit => new Option(unit, unit)));
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

form.addEventListener("submit", event => {
  event.preventDefault();
  try {
    const inputValue = readNumber(value);
    const result = formatNumber(convertUnits(quantity.value, from.value, to.value, inputValue));
    converted.value = result;
    const summary = quantity.value + " · " + formatNumber(inputValue) + " "
      + from.value + " = " + result + " " + to.value;
    history.add(summary, {
      quantity: quantity.value, from: from.value, to: to.value, value: value.value, output: result,
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
