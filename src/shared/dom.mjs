export function readNumber(input) {
  return input.value.trim() === "" ? NaN : Number(input.value);
}

export function formatNumber(value) {
  return String(Number(value.toPrecision(10)));
}

export function setStatus(element, message = "", isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

export function makeTableRow(body, values) {
  const row = body.insertRow();
  for (const value of values) row.insertCell().textContent = value;
  return row;
}
