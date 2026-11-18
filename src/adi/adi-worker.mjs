import { solveADI } from "./adi-engine.mjs";

self.onmessage = ({ data }) => {
  const start = performance.now();
  let lastUpdate = start;
  try {
    const values = solveADI(data, step => {
      const now = performance.now();
      if (now - lastUpdate >= 120 && step < data.nt) {
        self.postMessage({ type: "progress", step });
        lastUpdate = now;
      }
    });
    const inputBuffers = Object.values(data.coefficients).map(array => array.buffer);
    self.postMessage({ type: "result", values, problem: data, elapsed: performance.now() - start },
      [values.buffer, data.coupling.buffer, ...inputBuffers]);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
