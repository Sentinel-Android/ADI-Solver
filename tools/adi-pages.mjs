import { coefficientKeys, solveADI, solveHeat1D } from "../src/adi/adi-engine.mjs";
import { convertUnits, unitGroups } from "../src/adi/units.mjs";
import { formatNumber } from "../src/shared/dom.mjs";
import { equationReference } from "./adi-equations.mjs";
import { equations, escapeHtml, heading, historyPanel, mathText, noScript, numberField, symbolKey } from "./templates.mjs";

const setupFields = [
  ["nx", "Nx", "N_{x}", "Number of nodes in the x direction."],
  ["ny", "Ny", "N_{y}", "Number of nodes in the y direction."],
  ["m", "m", "m", "Number of variables or equations at each node."],
  ["dx", "dx", "Δx", "Grid spacing in the x direction, in metres for the heat example."],
  ["dy", "dy", "Δy", "Grid spacing in the y direction, in metres for the heat example."],
  ["nt", "Nt", "N_{t}", "Number of time steps."],
  ["dt", "dt", "Δt", "Time step size, in seconds for the heat example."],
];
const compass = [["north", "↑ e", "North · e", "e"], ["west", "← c", "West · c", "c"],
  ["center", "b", "Centre x · b", "b"], ["east", "a →", "East · a", "a"], ["south", "↓ g", "South · g", "g"]];
const otherCoefficients = [["f", "Centre y"], ["d", "Source x"], ["h", "Source y"], ["u0", "Initial U0"]];
const back = { href: "../", label: "Full ADI solver" };

function setupPanel() {
  return `<section class="panel" id="problem-setup" aria-labelledby="setup-title">
  <div class="panel-title adi-reference-header">
    <h2 id="setup-title">Problem setup</h2>
    <a href="#equations-and-coefficients">Equations and coefficient conversion</a>
  </div>
  <div class="panel-body">
    <form id="adi-setup" novalidate>
      <fieldset id="setup-controls">
        <div class="field-grid setup-grid">${setupFields.map(([name, label, symbol, description]) =>
          numberField(name, mathText(symbol), "", "", `aria-label="${label} · ${description}" title="${description}"`)).join("")}</div>
        <div class="setup-secondary">
          <div class="field"><label for="boundary">Boundary convention</label>
            <select id="boundary" name="boundary">
              <option value="fixed">Fixed edge values from U₀</option>
              <option value="desktop">Desktop compatibility</option>
            </select></div>
          <div class="actions">
            <button type="button" id="create-nodes">Create node table</button>
            <button type="button" id="zero-nodes" disabled>Fill all zeros</button>
            <button type="button" id="load-example">Load example</button>
            <button type="button" id="reset-solver">Reset</button>
            <button type="submit" class="primary" id="solve">Solve</button>
          </div>
        </div>
      </fieldset>
    </form>
    <div class="run-state">
      <progress id="solve-progress" aria-label="Solver progress" hidden></progress>
      <button type="button" id="cancel-solve" hidden>Cancel solve</button>
      <p class="status" id="adi-status" role="status"></p>
    </div>
  </div>
</section>`;
}

function navigatorPanel() {
  return `<section class="panel" aria-labelledby="navigator-title">
  <h2 class="panel-title" id="navigator-title">Node navigator</h2>
  <div class="panel-body">
    <fieldset id="node-nav" disabled>
      <div class="xyz">${["i", "j", "k"].map(key => `<div class="field"><label for="node-${key}">${key}</label>
        <input id="node-${key}" type="number" step="1" min="0" data-coordinate="${key}"></div>`).join("")}</div>
      <div class="node-jump"><button id="jump-node" type="button">Go to node</button><span class="mono small" id="selected-node" aria-live="polite">—</span></div>
      <div class="node-map" id="node-map" aria-label="Nearby nodes"></div>
      <div class="big-divider"></div>
      <p class="field-title">Jump to a coefficient</p>
      <div class="coeff-grid">${compass.map(([position, text, name, key]) =>

        `<button type="button" class="${position}" title="${name}" aria-label="${name}" data-coeff="${key}">${text}</button>`).join("")}</div>
      <div class="big-divider"></div>
      <div class="other-coeff">${otherCoefficients.map(([key, text]) =>
        `<button type="button" data-coeff="${key}">${text}${key === "u0" ? "" : " · " + key}</button>`).join("")}</div>
    </fieldset>
  </div>
</section>`;
}

function pager(name, hidden = false) {
  return `<div class="pager" id="${name}-pager"${hidden ? " hidden" : ""}>
  <span id="${name}-page" role="status">0 rows</span>
  <button type="button" id="${name}-prev" disabled>Previous</button>
  <button type="button" id="${name}-next" disabled>Next</button>
</div>`;
}

function nodePanels() {
  return `<div class="solver-center">
  <section class="panel" aria-label="Nodes and solution">
    <div role="tablist" aria-label="Solver tables" class="tabs">
      <button type="button" role="tab" id="input-tab" data-tab="inputs" aria-selected="true" aria-controls="inputs-panel">Node input table</button>
      <button type="button" role="tab" id="solution-tab" data-tab="solution" aria-selected="false" aria-controls="solution-panel" tabindex="-1">Final solution</button>
    </div>
    <div role="tabpanel" id="inputs-panel" aria-labelledby="input-tab">
      <fieldset id="node-entries" disabled>
        <p class="empty small" id="node-empty">Create the node table to enter coefficients.</p>
        <div class="table-wrap table-scroll" id="input-table" tabindex="0" aria-label="Scrollable node input table" hidden>
          <table class="cell-table"><thead><tr><th scope="col">Node (i,j,k)</th>
            ${coefficientKeys.map(key => `<th scope="col">${key === "u0" ? "U0" : key}</th>`).join("")}</tr></thead>
            <tbody id="node-body"></tbody></table>
        </div>
        ${pager("input", true)}
      </fieldset>
    </div>
    <div role="tabpanel" id="solution-panel" aria-labelledby="solution-tab" hidden>
      <p class="empty small" id="solution-empty">Run Solve to see the final value at each node.</p>
      <div class="table-wrap table-scroll" id="solution-table" tabindex="0" aria-label="Scrollable final solution table" hidden>
        <table class="solution-table"><thead><tr><th scope="col">Node (i,j,k)</th><th scope="col">Final U</th></tr></thead><tbody id="solution-body" class="table-numbers"></tbody></table>
      </div>
      ${pager("solution", true)}
    </div>
  </section>
  <details class="panel coupling" id="coupling-details" hidden>
    <summary>Local coupling matrix G</summary>
    <div class="panel-body">
      <p class="small muted">G[k, ℓ] multiplies variable ℓ in the equation for variable k at the same node. Leave entries at zero for uncoupled variables.</p>
      <fieldset id="coupling-controls" disabled>
        <div class="table-wrap" tabindex="0" aria-label="Scrollable coupling matrix"><table id="coupling-table" class="cell-table"></table></div>
      </fieldset>
    </div>
  </details>
</div>`;
}

function converter() {
  return `<section class="panel" aria-labelledby="unit-title">
  <h2 class="panel-title" id="unit-title">Unit converter</h2>
  <form class="panel-body unit-form" id="unit-form" novalidate>
    <div class="field-grid">
      <div class="field field-wide"><label for="quantity">Quantity</label>
        <select id="quantity" name="quantity">${Object.keys(unitGroups).map(group =>
          `<option>${group}</option>`).join("")}</select></div>
      <div class="field"><label for="unit-from">From</label><select id="unit-from" name="from"></select></div>
      <div class="field"><label for="unit-to">To</label><select id="unit-to" name="to"></select></div>
      <div class="field field-wide"><label for="unit-value">Value</label><input id="unit-value" name="value" type="number" step="any"></div>
      <div class="field field-wide"><label for="unit-converted">Converted value</label><input id="unit-converted" name="converted" type="text" readonly></div>
    </div>
    <div class="actions form-actions"><button class="primary" type="submit">Calculate + Copy</button></div>
    <p class="status" id="unit-status" role="status"></p>
  </form>
</section>`;
}

const unitHistory = () => historyPanel("unit-history", "Clipboard history", "No unit conversions saved on this page yet.");

const heatSymbols = [
  ["U", "Temperature in a consistent unit throughout the grid."],
  ["t, x", "Time in seconds and position in metres."],
  ["α", "Thermal diffusivity in m²/s."],
  ["Δx, Δt", "Grid spacing in metres and time step in seconds."],
  ["r", "Dimensionless diffusion number."],
  ["i", "Node index. The adjacent nodes are i − 1 and i + 1."],
  ["n", "Time-level index. n + 1 is the next time step."],
  ["U_{i}^{n}", "Temperature at node i and time level n."],
];

function heatPage(method) {
  const implicit = method === "implicit";
  const name = implicit ? "Implicit Method Calculator" : "Explicit Method Calculator";
  const sample = { values: [100, 0, 100], alpha: 1, dx: 1, dt: 0.1, nt: 1, implicit };
  const example = solveHeat1D(sample);
  const introduction = implicit
    ? "Solve the one-dimensional heat equation using the backward Euler implicit method and fixed temperatures at both ends."
    : "Solve the one-dimensional heat equation using the forward-time, centred-space explicit method and fixed temperatures at both ends.";
  const formula = implicit
    ? "−r U_{i−1}^{n+1} + (1 + 2r) U_{i}^{n+1} − r U_{i+1}^{n+1} = U_{i}^{n}"
    : "U_{i}^{n+1} = (1 − 2r) U_{i}^{n} + r U_{i−1}^{n} + r U_{i+1}^{n}";

  return {
    route: method + "-method-calculator/",
    title: name + " | 1D Heat Equation",
    description: introduction,
    scripts: ["heat-calculator.js"],
    content: () => heading(name, introduction, back) + noScript + `
<div class="calculator heat-layout">
  <section class="panel">
    <h2 class="panel-title">Problem setup</h2>
    <form id="heat-form" class="panel-body" data-method="${method}" novalidate>
      <div class="field-grid">
        ${numberField("alpha", "Thermal diffusivity α", "", "m²/s")}
        ${numberField("dx", "Grid spacing Δx", "", "m")}
        ${numberField("dt", "Time step Δt", "", "s")}
        ${numberField("nt", mathText("Number of steps N_{t}"), "")}
        <div class="field field-wide"><label for="values">Initial temperatures</label>
          <textarea id="values" name="values" rows="3" aria-describedby="profile-note"></textarea>
          <p id="profile-note" class="small muted">Enter values separated by commas or spaces. The first and last values are held fixed.</p>
        </div>
      </div>
      <div class="actions form-actions"><button class="primary" type="submit">Calculate</button>
        <button id="heat-example" type="button" data-example="${escapeHtml(JSON.stringify({ ...sample, values: sample.values.join(", ") }))}">Load example</button></div>
      <p class="status" id="heat-status" role="status"></p>
    </form>
  </section>
  <section class="panel">
    <h2 class="panel-title">Final temperatures</h2>
    <div class="panel-body">Diffusion number r <output id="diffusion-number">—</output></div>
    <div class="table-wrap" id="heat-results" hidden>
      <table><thead><tr><th>Node</th><th>Initial</th><th>Final</th></tr></thead><tbody></tbody></table>
    </div>
  </section>
</div>
<div class="section">${historyPanel("heat-history")}</div>
<section class="section prose"><h2>Formula</h2>
  ${equations(["∂U/∂t = α ∂^{2}U/∂x^{2}", "r = α Δt / (Δx)^{2}", formula])}
  ${symbolKey(heatSymbols)}
  <p>${implicit ? "The unknown temperatures at step n + 1 form a tridiagonal system solved at every step. For this diffusion problem, backward Euler has no r ≤ 0.5 stability restriction. Time step size still affects accuracy." : "Forward-time, centred-space updates each interior node from temperatures at the previous step. For this one-dimensional diffusion stencil, use r ≤ 0.5."}</p>
  <h2>Worked example</h2>
  <p>With α = 1 m²/s, Δx = 1 m, Δt = 0.1 s and initial temperatures [100, 0, 100], r = ${formatNumber(example.r)}. The calculator gives a centre temperature of <strong>${formatNumber(example.values[1])}</strong> after one step. The endpoints stay at 100.</p>
  <p><a href="../${implicit ? "explicit" : "implicit"}-method-calculator/">Try the ${implicit ? "explicit" : "implicit"} method</a> or read the <a href="../adi-method/">ADI method guide</a>.</p>
</section>`,
  };
}

const coefficientsForExample = Object.fromEntries(coefficientKeys.map(key => [key, new Float64Array(9)]));
for (const key of ["a", "c", "e", "g"]) coefficientsForExample[key][4] = 1;
for (const key of ["b", "f"]) coefficientsForExample[key][4] = -2;
coefficientsForExample.u0.set([100, 100, 100, 100, 0, 100, 100, 100, 100]);
const adiExample = solveADI({ nx: 3, ny: 3, m: 1, dx: 1, dy: 1, dt: 0.1, nt: 10,
  coefficients: coefficientsForExample, coupling: new Float64Array(1), boundary: "fixed" })[4];

export function adiPages() {
  return [
    {
      title: "ADI Solver | Alternating Direction Implicit Method Calculator",
      description: "Solve two-dimensional transient equations with Alternating Direction Implicit sweeps. Edit coefficients by node, navigate results, and convert engineering units.",
      scripts: ["solver.js", "unit-converter.js"],
      content: root => heading("ADI Solver", "Solve two-dimensional transient equations with the Alternating Direction Implicit method. Set up the grid, enter coefficients by node, and inspect the solution.")
        + noScript + setupPanel() + `<div class="solver-grid">${navigatorPanel()}${nodePanels()}
          <div class="tool-sidebar">${converter()}${unitHistory()}</div></div>`
        + equationReference(setupFields, "#problem-setup") + `
          <div class="section">${historyPanel("solver-history", "Solver history", "No solver runs saved yet.")}</div>
          <section class="section prose"><h2>Solver reference</h2>
            <p>The node table uses zero-based indices (i, j, k). The outer nodes remain fixed. Choose Desktop compatibility when comparing with the original Tkinter solver or when its boundary terms have already been accounted for in your coefficients.</p>
            <p><strong>Load example</strong> fills a 3 × 3 heat diffusion problem. With fixed edges at 100 and a starting centre value of 0, the centre reaches ${formatNumber(adiExample)} after 10 steps using the loaded settings.</p>
            <ul>
              <li><a href="${root}adi-method/">ADI method, formulas and coefficient definitions</a></li>
              <li><a href="${root}explicit-method-calculator/">Explicit method calculator</a></li>
              <li><a href="${root}implicit-method-calculator/">Implicit method calculator</a></li>
              <li><a href="${root}unit-converter/">Engineering unit converter</a></li>
            </ul>
          </section>`,
    },
    {
      route: "adi-method/", title: "Alternating Direction Implicit (ADI) Method and Coefficients",
      description: "Learn how the ADI method splits each time step, how to convert a discretised equation to a–h coefficients, and what each grid quantity represents.",
      content: () => heading("Alternating Direction Implicit method", "Equations, coefficients, and quantity definitions for the 2D solver.", back)
        + equationReference(setupFields, "../#problem-setup") + `
<div class="prose">
  <h2>Two directional sweeps</h2>
  <p>The Alternating Direction Implicit (ADI) method in Chapter 4 of the <em>Adsorption Chiller</em> project report treats x implicitly during the first half step and y implicitly during the second. The other direction is evaluated from known values in each sweep. The solver applies the Thomas algorithm to scalar tridiagonal systems and the Block Thomas algorithm to locally coupled variables.</p>
  ${equations([
    "(I − Δt L_{x}/2) U^{*} = (I + Δt L_{y}/2) U^{n} + Δt S/2",
    "(I − Δt L_{y}/2) U^{n+1} = (I + Δt L_{x}/2) U^{*} + Δt S/2",
    "S = d/Δx + h/Δy",
  ])}
  ${symbolKey([
    ["I", "Identity matrix."],
    ["Δt", "Full time step. Each sweep uses Δt/2."],
    ["L_{x}, L_{y}", "Discrete x and y operators. Each includes half of the local coupling matrix G."],
    ["U^{n}, U^{*}, U^{n+1}", "Current, intermediate, and next-step solution vectors."],
    ["n", "Time-level index."],
    ["S", "Combined source term for both directions."],
    ["d, h", "Source coefficients in the x and y directions."],
    ["Δx, Δy", "Grid spacing in the x and y directions."],
  ])}
  <h3>Coupled equations</h3>
  <p>When each node has multiple variables, use the same coefficient form for the state vector U and include the local coupling term.</p>
  ${equations(["∂U_{P}/∂t = (a U_{E} + b U_{P} + c U_{W} + d)/Δx + (e U_{N} + f U_{P} + g U_{S} + h)/Δy + G U_{P}"])}
  ${symbolKey([
    ["U_{P}", "State vector at the centre node."],
    ["U_{E}, U_{W}", "East and west neighbour vectors."],
    ["U_{N}, U_{S}", "North and south neighbour vectors."],
    ["G U_{P}", "Contribution of the variables at the centre node to each other through the coupling matrix G."],
  ])}
  <h2>Numerical method terms</h2>
</div>
<div class="panel table-wrap"><table>
  <thead><tr><th scope="col">Quantity</th><th scope="col">Definition</th></tr></thead>
  <tbody>
    <tr><th scope="row">Spatial coupling</th><td>Dependence between neighbouring nodes through the discretised x and y operators.</td></tr>
    <tr><th scope="row">Tridiagonal system</th><td>A linear system whose only potentially nonzero entries lie on the main and adjacent diagonals.</td></tr>
    <tr><th scope="row">Block Thomas method</th><td>A line solver that treats each tridiagonal entry as a matrix block so it can solve interacting variables together.</td></tr>
    <tr><th scope="row">Explicit method</th><td>Uses known values from the current step to calculate the next step directly.</td></tr>
    <tr><th scope="row">Implicit method</th><td>Includes unknown values from the next step in a system that is solved simultaneously.</td></tr>
  </tbody>
</table></div>
<section class="section prose">
  <h2>Boundary convention</h2>
  <p>Fixed edge values from U<sub>0</sub> are the default and enter both sweeps. Desktop compatibility reproduces the Python line solves, which omit the implicit end contributions while still using edge values in the explicit terms. A grid with fewer than three nodes in either direction returns the initial values.</p>
  <h2>Worked example</h2>
  <p>For α = 1, Δx = Δy = 1, Δt = 0.1 and N<sub>t</sub> = 10, set the edge values to 100 and the centre to 0 on a 3 × 3 grid. With fixed boundaries the solver returns <strong>${formatNumber(adiExample)}</strong> at (1, 1, 0). Use Load example in the <a href="../">full solver</a> to run these inputs.</p>
  <h2>References</h2><p>Project <em>Adsorption Chiller</em>, Chapter 4 (ADI method) and Chapter 5 (ADI Solver GUI), and the accompanying Python Tkinter source.</p>
</section>`,
    },
    heatPage("explicit"),
    heatPage("implicit"),
    {
      route: "unit-converter/", title: "Engineering Unit Converter | Converted Values and Clipboard",
      description: "Convert engineering units for length, pressure, temperature, energy, viscosity and more. Copy converted values and retrieve them from clipboard history.",
      scripts: ["unit-converter.js"],
      content: () => heading("Engineering unit converter", "Convert a quantity between units and copy the converted value for use in the solver.", back)
        + noScript + '<div class="calculator">' + converter() + unitHistory() + '</div>'
        + `<section class="section prose"><h2>Conversion formula</h2>
        ${equations(["v_{out} = v_{in} × (f_{in} / f_{out})"])}
        ${symbolKey([
          ["v_{in}, v_{out}", "Numerical values in the input and output units."],
          ["f_{in}, f_{out}", "Multipliers that express one unit of the input or output in a common base unit."],
        ])}
        <h3>Temperature scales</h3>
        ${equations(["T_{K} = T_{°C} + 273.15", "T_{°C} = (T_{°F} − 32) × 5/9"])}
        ${symbolKey([
          ["T_{K}", "Temperature in kelvins."],
          ["T_{°C}", "Temperature in degrees Celsius."],
          ["T_{°F}", "Temperature in degrees Fahrenheit."],
        ])}
        <h2>Worked example</h2><p>Pressure of 2 bar converts to <strong>${formatNumber(convertUnits("Pressure", "bar", "Pa", 2))} Pa</strong> using 100,000 Pa per bar.</p>
        <p>The available quantities follow the unit converter in Chapter 5 of the Adsorption Chiller project report.</p></section>`,
    },
  ];
}
