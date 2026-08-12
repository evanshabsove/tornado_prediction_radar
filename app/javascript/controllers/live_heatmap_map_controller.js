import { Controller } from "@hotwired/stimulus"
import L from "leaflet"

const DEFAULT_CENTER = [39.8, -98.5]
const DEFAULT_ZOOM = 4
const POLL_INTERVAL_MS = 75_000
const STALE_THRESHOLD_SECONDS = 150

// 0 -> cyan-600, 0.5 -> amber-500, 1 -> rose-600 (matches the legend gradient in the view)
const RAMP_STOPS = [
  [8, 145, 178],
  [245, 158, 11],
  [225, 29, 72]
]

function rampColor(t) {
  const scaled = t * (RAMP_STOPS.length - 1)
  const i = Math.min(Math.floor(scaled), RAMP_STOPS.length - 2)
  const localT = scaled - i
  const [r1, g1, b1] = RAMP_STOPS[i]
  const [r2, g2, b2] = RAMP_STOPS[i + 1]
  const r = Math.round(r1 + (r2 - r1) * localT)
  const g = Math.round(g1 + (g2 - g1) * localT)
  const b = Math.round(b1 + (b2 - b1) * localT)
  return `rgb(${r},${g},${b})`
}

export default class extends Controller {
  static targets = ["map", "status", "loading"]
  static values = { apiBaseUrl: String }

  connect() {
    this.map = L.map(this.mapTarget).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18
    }).addTo(this.map)
    this.heatmapLayer = null
    this.imageOverlay = null
    this.pollTimer = null
    this.currentSite = null
  }

  disconnect() {
    this.stopPolling()
    if (this.map) {
      this.map.remove()
      this.map = null
    }
  }

  onSiteSelected(event) {
    const site = event.detail.site
    if (site === this.currentSite) return

    this.stopPolling()
    this.currentSite = site
    this.clearLayers()
    this.loadHeatmap({ fitBounds: true })
    this.pollTimer = setInterval(() => this.loadHeatmap({ fitBounds: false }), POLL_INTERVAL_MS)
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async loadHeatmap({ fitBounds }) {
    const site = this.currentSite
    this.toggleHidden(this.loadingTarget, false)
    try {
      const res = await fetch(`${this.apiBaseUrlValue}/live/${site}/heatmap`)
      if (site !== this.currentSite) return // user switched sites while this was in flight

      if (res.status === 503) {
        this.clearLayers()
        this.showStatus("pending", "Waiting for this site's first radar volume…")
        return
      }

      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Heatmap request failed (${res.status})`)

      this.renderHeatmap(data, fitBounds)
    } catch (err) {
      this.showStatus("error", err.message || "Could not reach this site right now. Retrying on the next update.")
    } finally {
      this.toggleHidden(this.loadingTarget, true)
    }
  }

  renderHeatmap(data, fitBounds) {
    this.clearLayers()

    if (data.radar_image_url && data.radar_image_bounds) {
      this.imageOverlay = L.imageOverlay(data.radar_image_url, data.radar_image_bounds, { opacity: 0.6 }).addTo(
        this.map
      )
    }

    // Storm-triggered detection can return zero tiles on a clear-air volume, so
    // there may be nothing to add to the map or fit bounds to.
    const hasTiles = data.tiles.features.length > 0

    // Tiles are added after the image overlay so they render on top of it.
    this.heatmapLayer = L.geoJSON(data.tiles, {
      pointToLayer: (feature) => {
        const probability = feature.properties.probability
        const t = Math.min(probability, 1)
        const pct = (probability * 100).toFixed(2) + "%"
        return L.rectangle(feature.properties.bounds, {
          stroke: false,
          fillColor: rampColor(t),
          fillOpacity: 0.12 + t * 0.45
        }).bindTooltip(pct, { sticky: true })
      }
    }).addTo(this.map)

    if (fitBounds && hasTiles) this.map.fitBounds(this.heatmapLayer.getBounds())

    const staleness = Math.round(data.staleness_seconds)
    if (staleness > STALE_THRESHOLD_SECONDS) {
      this.showStatus("stale", `Updated ${staleness}s ago — data may be stuck (ingestion loop might be down)`)
    } else if (!hasTiles) {
      this.showStatus("ok", `Updated ${staleness}s ago — no storm signatures detected at this site`)
    } else {
      this.showStatus("ok", `Updated ${staleness}s ago`)
    }
  }

  clearLayers() {
    if (this.heatmapLayer) {
      this.map.removeLayer(this.heatmapLayer)
      this.heatmapLayer = null
    }
    if (this.imageOverlay) {
      this.map.removeLayer(this.imageOverlay)
      this.imageOverlay = null
    }
  }

  showStatus(kind, message) {
    const styles = {
      ok: "text-slate-500",
      pending: "rounded-md bg-slate-100 px-2 py-1 text-slate-600",
      stale: "rounded-md bg-amber-50 px-2 py-1 text-amber-700",
      error: "rounded-md bg-amber-50 px-2 py-1 text-amber-700"
    }
    this.statusTarget.textContent = message
    this.statusTarget.className = `text-xs ${styles[kind]}`
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}
