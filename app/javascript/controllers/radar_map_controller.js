import { Controller } from "@hotwired/stimulus"
import L from "leaflet"

const DEFAULT_CENTER = [39.8, -98.5]
const DEFAULT_ZOOM = 4

const TIERS = {
  low: { markerColor: "#059669", badgeClass: "bg-emerald-100 text-emerald-700 ring-emerald-300" },
  moderate: { markerColor: "#d97706", badgeClass: "bg-amber-100 text-amber-700 ring-amber-300" },
  high: { markerColor: "#e11d48", badgeClass: "bg-rose-100 text-rose-700 ring-rose-300" }
}

function tierFor(probability) {
  if (probability >= 0.4) return "high"
  if (probability >= 0.1) return "moderate"
  return "low"
}

export default class extends Controller {
  static targets = ["map", "probability", "placeholder", "loading", "error"]
  static values = { apiBaseUrl: String }

  connect() {
    this.map = L.map(this.mapTarget).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18
    }).addTo(this.map)
    this.marker = null
    this.overlay = null
  }

  disconnect() {
    if (this.map) {
      this.map.remove()
      this.map = null
    }
  }

  onStormSelected(event) {
    this.loadPrediction(event.detail.stormId)
  }

  async loadPrediction(stormId) {
    this.clearError()
    this.toggleHidden(this.loadingTarget, false)
    try {
      const res = await fetch(`${this.apiBaseUrlValue}/predict/${stormId}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Prediction request failed (${res.status})`)
      this.renderPrediction(data)
    } catch (err) {
      this.showError(err.message || "Failed to load prediction. Please try again.")
    } finally {
      this.toggleHidden(this.loadingTarget, true)
    }
  }

  renderPrediction(data) {
    this.clearMapLayers()

    const [lon, lat] = data.geojson.coordinates
    const tier = tierFor(data.probability)
    const pct = (data.probability * 100).toFixed(1) + "%"

    this.marker = L.circleMarker([lat, lon], {
      radius: 10,
      weight: 2,
      color: "#fff",
      fillColor: TIERS[tier].markerColor,
      fillOpacity: 0.9
    }).addTo(this.map)
    this.marker.bindPopup(`Storm ${data.storm_id}<br>Tornado probability: ${pct}`).openPopup()

    this.toggleHidden(this.placeholderTarget, true)
    this.probabilityTarget.textContent = `Storm ${data.storm_id} · ${pct}`
    this.probabilityTarget.className =
      `inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset ${TIERS[tier].badgeClass}`

    if (data.radar_image_url && data.radar_image_bounds) {
      this.overlay = L.imageOverlay(data.radar_image_url, data.radar_image_bounds, { opacity: 0.6 }).addTo(
        this.map
      )
      this.map.fitBounds(data.radar_image_bounds)
    } else {
      this.overlay = null
      this.map.setView([lat, lon], 9)
    }
  }

  clearMapLayers() {
    if (this.marker) {
      this.map.removeLayer(this.marker)
      this.marker = null
    }
    if (this.overlay) {
      this.map.removeLayer(this.overlay)
      this.overlay = null
    }
  }

  showError(message) {
    this.errorTarget.textContent = message
    this.toggleHidden(this.errorTarget, false)
  }

  clearError() {
    this.errorTarget.textContent = ""
    this.toggleHidden(this.errorTarget, true)
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}
