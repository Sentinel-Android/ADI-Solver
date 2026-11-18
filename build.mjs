import { fileURLToPath } from "node:url";
import settings from "./site.config.mjs";
import { buildSite } from "./tools/build-site.mjs";
import { adiPages } from "./tools/adi-pages.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
await buildSite(root, {
  ...settings,
  key: "adi",
  name: "ADI Solver",
  mark: "Δ",
  homeLabel: "Full ADI solver",
  navigation: [["", "Solver"], ["adi-method/", "ADI method & definitions"], ["explicit-method-calculator/", "Explicit"],
    ["implicit-method-calculator/", "Implicit"], ["unit-converter/", "Unit converter"]],
}, adiPages, {
  solver: "src/adi/solver.mjs",
  "heat-calculator": "src/adi/heat-calculator.mjs",
  "unit-converter": "src/adi/unit-converter.mjs",
}, "src/adi/adi-worker.mjs");
