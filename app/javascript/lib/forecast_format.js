// All forecast times are UTC (the API sends ISO-8601 with a trailing Z).
export const BIN_HOURS = 4
const HOUR_MS = 3600 * 1000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const pad = (n) => String(n).padStart(2, "0")
const hourZ = (d) => `${pad(d.getUTCHours())}Z`
const dayLabel = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
const sameUtcDay = (a, b) => dayLabel(a) === dayLabel(b)

// "Oct 21 03Z"
export function formatRunLabel(iso) {
  const d = new Date(iso)
  return `${dayLabel(d)} ${hourZ(d)}`
}

// "Oct 21 03Z–07Z", or "Oct 21 21Z – Oct 22 01Z" when the window crosses 00Z.
export function formatWindow(startIso, endIso) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (sameUtcDay(start, end)) return `${dayLabel(start)} ${hourZ(start)}–${hourZ(end)}`
  return `${dayLabel(start)} ${hourZ(start)} – ${dayLabel(end)} ${hourZ(end)}`
}

// The API parses timestamps strictly as `YYYY-MM-DDTHH:MM:SSZ`; it rejects the `.000` Date#toISOString adds.
const apiTimestamp = (ms) => new Date(ms).toISOString().replace(".000Z", "Z")

// Window of a 4-hour bin, derived from the run's init time (bin 0 = [init, init+4h)).
export function binWindow(initIso, bin) {
  const init = Date.parse(initIso)
  return {
    start: apiTimestamp(init + bin * BIN_HOURS * HOUR_MS),
    end: apiTimestamp(init + (bin + 1) * BIN_HOURS * HOUR_MS)
  }
}

// "03–07Z", for the compact bin buttons.
export function formatBinLabel(initIso, bin) {
  const { start, end } = binWindow(initIso, bin)
  return `${pad(new Date(start).getUTCHours())}–${hourZ(new Date(end))}`
}

// Age of the model run, computed from init time (a cached response's own age is stale).
export function ageSeconds(initIso, now = Date.now()) {
  return Math.max(0, Math.round((now - Date.parse(initIso)) / 1000))
}

export function formatAge(seconds) {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}

// Percentages here are measured hit rates and area shares, some well under 1%.
export function formatPercent(fraction) {
  const p = fraction * 100
  return `${p >= 1 ? p.toFixed(1) : p.toPrecision(2)}%`
}
