export const unitGroups = {
  "Length": {
    "m": 1.0,
    "cm": 0.01,
    "mm": 0.001,
    "km": 1000.0,
    "inch": 0.0254,
    "ft": 0.3048
  },
  "Area": {
    "m^2": 1.0,
    "cm^2": 0.0001,
    "mm^2": 1e-06,
    "ft^2": 0.09290304,
    "inch^2": 0.00064516
  },
  "Volume": {
    "m^3": 1.0,
    "L": 0.001,
    "mL": 1e-06,
    "cm^3": 1e-06,
    "ft^3": 0.028316846592
  },
  "Pressure": {
    "Pa": 1.0,
    "kPa": 1000.0,
    "MPa": 1000000.0,
    "bar": 100000.0,
    "atm": 101325.0,
    "psi": 6894.757293168
  },
  "Temperature": {
    "C": null,
    "K": null,
    "F": null
  },
  "Mass": {
    "kg": 1.0,
    "g": 0.001,
    "mg": 1e-06,
    "tonne": 1000.0,
    "lb": 0.45359237
  },
  "Time": {
    "s": 1.0,
    "min": 60.0,
    "hr": 3600.0
  },
  "Velocity": {
    "m/s": 1.0,
    "cm/s": 0.01,
    "mm/s": 0.001,
    "km/hr": 0.2777777777777778,
    "ft/s": 0.3048
  },
  "Mass Flow Rate": {
    "kg/s": 1.0,
    "kg/min": 0.016666666666666666,
    "kg/hr": 0.0002777777777777778,
    "g/s": 0.001
  },
  "Volumetric Flow Rate": {
    "m^3/s": 1.0,
    "m^3/hr": 0.0002777777777777778,
    "L/s": 0.001,
    "L/min": 1.6666666666666667e-05
  },
  "Energy": {
    "J": 1.0,
    "kJ": 1000.0,
    "MJ": 1000000.0,
    "cal": 4.184,
    "kcal": 4184.0,
    "Wh": 3600.0,
    "kWh": 3600000.0
  },
  "Power": {
    "W": 1.0,
    "kW": 1000.0,
    "MW": 1000000.0,
    "hp": 745.699872
  },
  "Specific Heat": {
    "J/kg.K": 1.0,
    "kJ/kg.K": 1000.0,
    "J/g.K": 1000.0,
    "cal/g.K": 4184.0
  },
  "Thermal Conductivity": {
    "W/m.K": 1.0,
    "kW/m.K": 1000.0,
    "W/cm.K": 100.0
  },
  "Dynamic Viscosity": {
    "Pa.s": 1.0,
    "cP": 0.001,
    "kg/m.s": 1.0
  },
  "Density": {
    "kg/m^3": 1.0,
    "g/cm^3": 1000.0,
    "kg/L": 1000.0
  }
};

const temperatureScales = {
  C: { kelvin: value => value + 273.15, fromKelvin: value => value - 273.15 },
  K: { kelvin: value => value, fromKelvin: value => value },
  F: {
    kelvin: value => (value - 32) * 5 / 9 + 273.15,
    fromKelvin: value => (value - 273.15) * 9 / 5 + 32,
  },
};

export function convertUnits(group, input, output, value) {
  const units = unitGroups[group];
  if (!units || !Object.hasOwn(units, input) || !Object.hasOwn(units, output)) {
    throw new Error("Select a quantity and valid units.");
  }
  if (!Number.isFinite(value)) throw new Error("Enter a finite input value.");
  if (input === output) return value;
  const result = group === "Temperature"
    ? temperatureScales[output].fromKelvin(temperatureScales[input].kelvin(value))
    : value * (units[input] / units[output]);
  if (!Number.isFinite(result)) throw new Error("The converted value exceeds the numerical range.");
  return result;
}
