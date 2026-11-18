import { mathText, symbolKey } from "./templates.mjs";

const alpha = "<mi>α</mi>";
const plus = "<mo>+</mo>";
const minus = "<mo>−</mo>";
const equal = "<mo>=</mo>";
const fraction = (top, bottom) => `<mfrac><mrow>${top}</mrow><mrow>${bottom}</mrow></mfrac>`;
const spacing = axis => `<mi>Δ</mi><mi>${axis}</mi>`;
const spacingSquared = axis => `<msup><mrow><mo>(</mo>${spacing(axis)}<mo>)</mo></mrow><mn>2</mn></msup>`;

function secondDerivative(axis) {
  const partialSquared = "<msup><mo>∂</mo><mn>2</mn></msup>";
  return fraction(`${partialSquared}<mi>T</mi>`, `<mo>∂</mo><msup><mi>${axis}</mi><mn>2</mn></msup>`);
}

function atTemperature(iOffset = 0, jOffset = 0, nextStep = true) {
  const index = (axis, offset) => `<mi>${axis}</mi>`
    + (offset ? `${offset > 0 ? plus : minus}<mn>1</mn>` : "");
  return `<msubsup><mi>T</mi><mrow>${index("i", iOffset)}<mo>,</mo>${index("j", jOffset)}</mrow>
    <mrow><mi>n</mi>${nextStep ? plus + "<mn>1</mn>" : ""}</mrow></msubsup>`;
}

const center = atTemperature();
const east = atTemperature(1, 0);
const west = atTemperature(-1, 0);
const north = atTemperature(0, 1);
const south = atTemperature(0, -1);
const timeDifference = fraction(center + minus + atTemperature(0, 0, false), spacing("t"));
const heatEquation = fraction("<mo>∂</mo><mi>T</mi>", "<mo>∂</mo><mi>t</mi>")
  + equal + alpha + "<mo>(</mo>" + secondDerivative("x") + plus + secondDerivative("y") + "<mo>)</mo>";

function secondDifference(forward, backward, axis) {
  return fraction(forward + minus + "<mn>2</mn>" + center + plus + backward, spacingSquared(axis));
}

const discretizedHeat = timeDifference + equal + alpha + "<mo>(</mo>"
  + secondDifference(east, west, "x") + plus + secondDifference(north, south, "y") + "<mo>)</mo>";

const coefficientForm = timeDifference + equal
  + fraction(`<mi>a</mi>${east}${plus}<mi>b</mi>${center}${plus}<mi>c</mi>${west}${plus}<mi>d</mi>`, spacing("x"))
  + plus
  + fraction(`<mi>e</mi>${north}${plus}<mi>f</mi>${center}${plus}<mi>g</mi>${south}${plus}<mi>h</mi>`, spacing("y"));

const refactorX = fraction(alpha + "<mo>(</mo>" + east + minus + "<mn>2</mn>" + center + plus + west + "<mo>)</mo>",
  spacingSquared("x")) + equal
  + fraction(fraction(alpha, spacing("x")) + east + minus + fraction("<mn>2</mn>" + alpha, spacing("x")) + center
    + plus + fraction(alpha, spacing("x")) + west, spacing("x"));

const heatCoefficients = [
  ["a", "East neighbour (i + 1, j)", "α/Δx"],
  ["b", "Centre node, x direction", "−2α/Δx"],
  ["c", "West neighbour (i − 1, j)", "α/Δx"],
  ["d", "Source term, x direction", "0"],
  ["e", "North neighbour (i, j + 1)", "α/Δy"],
  ["f", "Centre node, y direction", "−2α/Δy"],
  ["g", "South neighbour (i, j − 1)", "α/Δy"],
  ["h", "Source term, y direction", "0"],
];

function displayMath(content, label, compact = false) {
  return `<div class="adi-math${compact ? " adi-math-compact" : ""}" tabindex="0" role="region"
    aria-label="${label}"><math display="block">${content}</math></div>`;
}

export function equationReference(setupFields, returnLink) {
  return `<section class="section adi-reference" id="equations-and-coefficients" aria-labelledby="equations-heading">
  <header class="adi-reference-header">
    <h2 id="equations-heading">Equations and coefficient conversion</h2>
    <a href="${returnLink}">Go to problem setup</a>
  </header>
  <div class="panel panel-body">
    <h3>Start with the 2D heat equation</h3>
    ${displayMath(heatEquation, "Two-dimensional heat equation", true)}
    <h3>Discretise time and space</h3>
    <p>Use a backward difference in time and centred second differences in space. The discrete equation at an interior node is</p>
    ${displayMath(discretizedHeat, "Backward time difference and centred spatial differences")}
    <h3>Match the solver’s coefficient form</h3>
    <p>Factor one grid spacing out of each spatial denominator. For the x direction, the conversion is</p>
    ${displayMath(refactorX, "Factoring the x-direction heat diffusion term")}
    <p>Do the same for the y direction, then match the two numerators to this form.</p>
    ${displayMath(coefficientForm, "Solver form with coefficients a through h")}
    <p class="small muted">The form above shows all spatial terms at time level <var>n</var> + 1. ADI uses the same coefficients in two sweeps, treating x implicitly first and y implicitly second.</p>
    <div class="adi-reference-grid">
      <section>
        <h3>Coefficients to enter</h3>
        <div class="table-wrap">
          <table class="adi-coefficient-table">
            <thead><tr><th scope="col">Input</th><th scope="col">Meaning</th><th scope="col">Heat equation value</th></tr></thead>
            <tbody>${heatCoefficients.map(([key, definition, value]) =>
              `<tr><th scope="row"><var>${key}</var></th><td>${definition}</td><td>${mathText(value)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
        <p class="small">For constant thermal diffusivity, use these values at every interior node. Enter the initial temperatures in <strong>U<sub>0</sub></strong>, set <var>m</var> = 1 and leave <var>G</var> at zero.</p>
      </section>
      <div>
        ${symbolKey([
          ["T", "Temperature in a consistent unit throughout the grid."],
          ["T_{i,j}^{n}", "Temperature at grid node (i, j) at the current time level n. The superscript n + 1 indicates the next time level."],
          ["x, y, t", "Spatial coordinates x and y in metres, and time t in seconds."],
          ["i, j, k", "Zero-based x-node, y-node, and variable indices. In this single-temperature model, k is 0."],
          ["α", "Thermal diffusivity, in m²/s."],
          ...setupFields.map(([, , symbol, definition]) => [symbol, definition]),
          ["U_{0}", "Initial values on the grid. For heat diffusion these are the temperatures at time level 0."],
          ["G", "m × m matrix for coupling different variables at the same node."],
        ])}
      </div>
    </div>
  </div>
</section>`;
}
