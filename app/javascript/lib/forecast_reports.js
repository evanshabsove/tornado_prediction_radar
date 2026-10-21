// SPC tornado reports drawn over a replay. Colours are a purple ramp so they stay
// distinct from the red/amber tier fills they sit on; unrated reports are white.
export const EF_COLORS = {
  0: "#c4b5fd",
  1: "#8b5cf6",
  2: "#6d28d9",
  3: "#4c1d95",
  4: "#2e1065",
  5: "#000000"
}
export const UNRATED_COLOR = "#ffffff"

export const efColor = (rating) => (rating === null || rating === undefined ? UNRATED_COLOR : EF_COLORS[rating])
export const efLabel = (rating) => (rating === null || rating === undefined ? "EF unrated" : `EF${rating}`)

// "Dec 10 22:12Z" (touchdown time, UTC)
export function formatTouchdown(iso) {
  const d = new Date(iso)
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
  const pad = (n) => String(n).padStart(2, "0")
  return `${month} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
}

// Popup body for a report; plain text nodes, no HTML from the API is interpreted.
export function reportPopup(props) {
  const root = document.createElement("div")
  const title = document.createElement("p")
  title.className = "font-semibold"
  title.textContent = `${efLabel(props.ef_rating)} tornado${props.state ? ` · ${props.state}` : ""}`
  const when = document.createElement("p")
  when.textContent = `Touchdown ${formatTouchdown(props.timestamp_utc)}`
  const size = document.createElement("p")
  size.textContent = `Path ${props.length_mi} mi long, ${props.width_yd} yd wide`
  // Leaflet's popup CSS gives <p> a 17px margin.
  for (const line of [title, when, size]) line.style.margin = "2px 0"
  root.append(title, when, size)
  return root
}
