// Tier codes are assigned by the forecast API (see docs/forecast/forecast_api_contract.md);
// the client only maps a code to a look, it never derives a tier from a score.
export const NO_COVERAGE = -1
export const LOW = 0
export const ELEVATED = 1
export const HIGH = 2

// `fillOpacity` is what the map draws. `legendOpacity` is the same colour made
// visible on a white swatch (Low is deliberately near-transparent on the map).
// `hover` is the wording for the hover tooltip: "relative risk", never "likely".
export const TIERS = {
  [NO_COVERAGE]: { name: "No model coverage", color: "#64748b", fillOpacity: 0.45, legendOpacity: 0.45 },
  [LOW]: { name: "Low", color: "#38bdf8", fillOpacity: 0.16, legendOpacity: 0.45, hover: "lower relative risk (not a safe cell)" },
  [ELEVATED]: { name: "Elevated", color: "#f59e0b", fillOpacity: 0.75, legendOpacity: 0.75, hover: "elevated relative risk" },
  [HIGH]: { name: "High", color: "#dc2626", fillOpacity: 0.85, legendOpacity: 0.85, hover: "highest relative risk" }
}

// Leaflet path options for one cell. The cells are an unbroken mesh, so no stroke.
export function cellStyle(tier) {
  const t = TIERS[tier]
  return { stroke: false, fill: true, fillColor: t.color, fillOpacity: t.fillOpacity, interactive: false }
}
