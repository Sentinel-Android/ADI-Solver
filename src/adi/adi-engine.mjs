export const coefficientKeys = ["a", "b", "c", "d", "e", "f", "g", "h", "u0"];
export const maxValues = 500_000;
export const maxVariables = 32;

export function validateGrid(nx, ny, m) {
  if (![nx, ny, m].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Nx, Ny, and m must be positive integers.");
  }
  if (m > maxVariables || nx * ny * m > maxValues) {
    throw new Error("Use up to 32 variables per node and 500,000 node-variable rows.");
  }
}

function validateProblem({ nx, ny, m, dx, dy, dt, nt, coefficients, coupling, boundary }) {
  validateGrid(nx, ny, m);
  if (![dx, dy, dt].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("dx, dy, and dt must be positive, finite numbers.");
  }
  if (!Number.isSafeInteger(nt) || nt < 1) throw new Error("Nt must be a positive integer.");
  const size = nx * ny * m;
  for (const key of coefficientKeys) {
    if (coefficients[key]?.length !== size || !coefficients[key].every(Number.isFinite)) {
      throw new Error("Enter a finite value for every " + (key === "u0" ? "U0" : key) + " field.");
    }
  }
  if (coupling.length !== m * m || !coupling.every(Number.isFinite)) {
    throw new Error("G must be an m × m matrix with finite entries.");
  }
  if (boundary !== "fixed" && boundary !== "desktop") throw new Error("Choose a boundary convention.");
}

function scalarSweep(axis, explicit, input, output, weights, source, upper, rhs, fixed) {
  const { m, extent, lineCount, stride, lineStride, low, high, center, scale } = axis;
  const otherStride = explicit.stride;
  for (let line = 1; line <= lineCount; line++) {
    const edge = line * lineStride;
    for (let k = 0; k < m; k++) {
      let previousUpper = 0;
      let previousRhs = 0;
      const local = weights[k * m + k];
      for (let node = 0; node < extent; node++) {
        const i = edge + (node + 1) * stride + k;
        const a = -scale * low[i];
        const c = -scale * high[i];
        let d = input[i] + local * input[i] + source[i]
          + explicit.scale * (explicit.low[i] * input[i - otherStride]
            + explicit.center[i] * input[i] + explicit.high[i] * input[i + otherStride]);
        if (fixed && node === 0) d -= a * input[i - stride];
        if (fixed && node === extent - 1) d -= c * input[i + stride];
        const pivot = 1 - scale * center[i] - local - a * previousUpper;
        if (!Number.isFinite(pivot) || pivot === 0) {
          throw new Error("The " + axis.name + " sweep has a singular or non-finite pivot.");
        }
        previousUpper = node === extent - 1 ? 0 : c / pivot;
        previousRhs = (d - a * previousRhs) / pivot;
        upper[node] = previousUpper;
        rhs[node] = previousRhs;
      }
      let next = 0;
      for (let node = extent - 1; node >= 0; node--) {
        const i = edge + (node + 1) * stride + k;
        next = rhs[node] - upper[node] * next;
        if (!Number.isFinite(next)) throw new Error("The " + axis.name + " sweep produced a non-finite value.");
        output[i] = next;
      }
    }
  }
}

// Solve [B | C | D] in place with partial pivoting. The two RHS groups
// become the modified upper block and vector for block Thomas.
function solveBlock(augmented, m, width) {
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let row = col + 1; row < m; row++) {
      if (Math.abs(augmented[row * width + col]) > Math.abs(augmented[pivot * width + col])) pivot = row;
    }
    if (pivot !== col) {
      for (let j = col; j < width; j++) {
        const offset = col * width + j;
        const swap = pivot * width + j;
        const value = augmented[offset];
        augmented[offset] = augmented[swap];
        augmented[swap] = value;
      }
    }
    const rowStart = col * width;
    const divisor = augmented[rowStart + col];
    if (!Number.isFinite(divisor) || divisor === 0) throw new Error("A coupling block has a singular or non-finite pivot.");
    for (let j = col + 1; j < width; j++) augmented[rowStart + j] /= divisor;
    for (let row = col + 1; row < m; row++) {
      const rowOffset = row * width;
      const factor = augmented[rowOffset + col];
      for (let j = col + 1; j < width; j++) augmented[rowOffset + j] -= factor * augmented[rowStart + j];
    }
  }
  for (let col = m - 1; col > 0; col--) {
    for (let row = 0; row < col; row++) {
      const offset = row * width;
      const factor = augmented[offset + col];
      for (let j = m; j < width; j++) augmented[offset + j] -= factor * augmented[col * width + j];
    }
  }
}

function blockSweep(axis, explicit, input, output, weights, source, upper, rhs, augmented, fixed) {
  const { m, extent, lineCount, stride, lineStride, low, high, center, scale } = axis;
  const otherStride = explicit.stride;
  const square = m * m;
  const width = 2 * m + 1;
  for (let line = 1; line <= lineCount; line++) {
    const edge = line * lineStride;
    for (let node = 0; node < extent; node++) {
      const base = edge + (node + 1) * stride;
      const blockOffset = node * square;
      const rhsOffset = node * m;
      for (let row = 0; row < m; row++) {
        const i = base + row;
        const a = -scale * low[i];
        const c = -scale * high[i];
        const rowOffset = row * width;
        let d = input[i] + source[i] + explicit.scale * (
          explicit.low[i] * input[i - otherStride] + explicit.center[i] * input[i]
          + explicit.high[i] * input[i + otherStride]);
        for (let col = 0; col < m; col++) {
          const weight = weights[row * m + col];
          const previous = node === 0 ? 0 : a * upper[blockOffset - square + row * m + col];
          augmented[rowOffset + col] = (row === col ? 1 - scale * center[i] : 0) - weight - previous;
          augmented[rowOffset + m + col] = row === col && node < extent - 1 ? c : 0;
          d += weight * input[base + col];
        }
        if (node > 0) d -= a * rhs[rhsOffset - m + row];
        if (fixed && node === 0) d -= a * input[i - stride];
        if (fixed && node === extent - 1) d -= c * input[i + stride];
        augmented[rowOffset + width - 1] = d;
      }

      solveBlock(augmented, m, width);
      for (let row = 0; row < m; row++) {
        const rowOffset = row * width;
        for (let col = 0; col < m; col++) {
          upper[blockOffset + row * m + col] = augmented[rowOffset + m + col];
        }
        rhs[rhsOffset + row] = augmented[rowOffset + width - 1];
      }
    }

    for (let node = extent - 1; node >= 0; node--) {
      const base = edge + (node + 1) * stride;
      for (let row = 0; row < m; row++) {
        let value = rhs[node * m + row];
        if (node < extent - 1) {
          const offset = node * square + row * m;
          for (let col = 0; col < m; col++) value -= upper[offset + col] * output[base + stride + col];
        }
        if (!Number.isFinite(value)) throw new Error("The " + axis.name + " sweep produced a non-finite value.");
        output[base + row] = value;
      }
    }
  }
}

export function solveADI(problem, onStep = () => {}) {
  validateProblem(problem);
  const { nx, ny, m, dx, dy, dt, nt, coefficients, coupling, boundary } = problem;
  const { a, b, c, d, e, f, g, h, u0 } = coefficients;
  const solution = u0.slice();
  if (nx < 3 || ny < 3) {
    onStep(nt);
    return solution;
  }

  const scaleX = (dt / 2) / dx;
  const scaleY = (dt / 2) / dy;
  const x = { name: "x", extent: nx - 2, lineCount: ny - 2, stride: ny * m, lineStride: m,
    low: c, high: a, center: b, scale: scaleX, m };
  const y = { name: "y", extent: ny - 2, lineCount: nx - 2, stride: m, lineStride: ny * m,
    low: g, high: e, center: f, scale: scaleY, m };

  const halfStep = solution.slice();
  const source = Float64Array.from(d, (value, index) => scaleX * value + scaleY * h[index]);
  const weights = Float64Array.from(coupling, value => (dt / 4) * value);
  const hasCrossCoupling = coupling.some((value, index) => index % (m + 1) !== 0 && value !== 0);
  const lineLength = Math.max(x.extent, y.extent);
  const upper = new Float64Array(lineLength * (hasCrossCoupling ? m * m : 1));
  const rhs = new Float64Array(lineLength * (hasCrossCoupling ? m : 1));
  const augmented = hasCrossCoupling ? new Float64Array(m * (2 * m + 1)) : null;
  const fixed = boundary === "fixed";

  for (let step = 1; step <= nt; step++) {
    try {
      if (hasCrossCoupling) {
        blockSweep(x, y, solution, halfStep, weights, source, upper, rhs, augmented, fixed);
        blockSweep(y, x, halfStep, solution, weights, source, upper, rhs, augmented, fixed);
      } else {
        scalarSweep(x, y, solution, halfStep, weights, source, upper, rhs, fixed);
        scalarSweep(y, x, halfStep, solution, weights, source, upper, rhs, fixed);
      }
    } catch (error) {
      throw new Error("Step " + step + ". " + error.message);
    }
    onStep(step);
  }
  return solution;
}

export function solveHeat1D({ values, alpha, dx, dt, nt, implicit }) {
  if (values.length < 3 || values.length > 500 || !values.every(Number.isFinite)) {
    throw new Error("Enter between 3 and 500 finite initial values.");
  }
  if (![alpha, dx, dt].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Diffusivity, spacing, and step size must be positive.");
  }
  if (!Number.isSafeInteger(nt) || nt < 1 || nt > 10000) {
    throw new Error("Enter 1 to 10,000 time steps.");
  }
  const r = (alpha / dx) * (dt / dx);
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
        work[i] = rhs / diagonal[i] + (r / diagonal[i]) * work[i - 1];
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
