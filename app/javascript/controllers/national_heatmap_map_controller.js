import { Controller } from "@hotwired/stimulus"
import L from "leaflet"
import "leaflet.heat"

const DEFAULT_CENTER = [39.8, -98.5]
const DEFAULT_ZOOM = 4

// The API returns probability as a 0-1 fraction (0.109 = 10.9%). Point weights
// below are scaled to that same 0-100 percentage convention, so this `max`
// represents "100% probability" - the theoretical ceiling - rather than
// anything we expect to actually see. Real readings stay in the gradient's
// cool/blue end (below fraction 0.4) unless something crosses ~40% probability.
const HEAT_MAX = 100

// Points are now one-per-site (see refresh()) rather than one per tile, so
// radius/blur need to visually stand in for each site's whole coverage area
// instead of just a single tile. Bumped up from the single-tile starting
// point (20/15) - re-tune once you see it rendered.
const HEAT_RADIUS = 35
const HEAT_BLUR = 25

// Leaflet.heat's `minOpacity` guards against `0` with `opts.minOpacity || 0.05`,
// so passing 0 silently falls back to a 5% floor per point - use a tiny
// non-zero value instead so it only floors genuinely near-zero-probability sites.
const HEAT_MIN_OPACITY = 0.0005

// Small visible marker at each site's actual radar location (see refresh()),
// so it's clear where the forecasts are physically coming from.
const SITE_MARKER_RADIUS = 4

// Reflectivity images overlap by design between adjacent sites, so opacity is
// kept moderate to avoid overlap zones compositing into an overly dark blob.
const RADAR_IMAGE_OPACITY = 0.45

export default class extends Controller {
  static targets = ["map", "status", "loading", "refreshButton", "radarImageToggle"]
  static values = { apiBaseUrl: String }

  connect() {
    console.log("[national] connect. typeof L.heatLayer =", typeof L.heatLayer)
    this.map = L.map(this.mapTarget).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18
    }).addTo(this.map)
    this.heatLayer = null
    this.radarImageLayer = L.layerGroup().addTo(this.map)
    this.siteMarkersLayer = L.layerGroup().addTo(this.map)
    window.__national = this
    this.refresh()
  }

  toggleRadarImages() {
    if (this.radarImageToggleTarget.checked) {
      this.map.addLayer(this.radarImageLayer)
    } else {
      this.map.removeLayer(this.radarImageLayer)
    }
  }

  disconnect() {
    if (this.map) {
      this.map.remove()
      this.map = null
    }
  }

  async refresh() {
    this.toggleHidden(this.loadingTarget, false)
    this.refreshButtonTarget.disabled = true

    console.log("[national] refresh: apiBaseUrl =", this.apiBaseUrlValue)

    try {
      const sitesRes = await fetch(`${this.apiBaseUrlValue}/live/sites`)
      console.log("[national] /live/sites status:", sitesRes.status)
      if (!sitesRes.ok) throw new Error(`Failed to load site list (${sitesRes.status})`)
      const sitesData = await sitesRes.json()
      const okSites = (sitesData.sites || []).filter((s) => s.status === "ok")
      console.log("[national] total sites:", (sitesData.sites || []).length, "ok sites:", okSites.length)

      if (okSites.length === 0) {
        this.clearLayer()
        this.showStatus("error", "No sites are currently reporting data.")
        return
      }

      let fetchFailures = 0
      const results = await Promise.all(
        okSites.map((s) =>
          fetch(`${this.apiBaseUrlValue}/live/${s.site}/heatmap`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${s.site}: HTTP ${res.status}`))))
            .catch((err) => {
              fetchFailures++
              console.warn("[national] heatmap fetch failed for", s.site, err)
              return null
            })
        )
      )
      console.log("[national] heatmap fetches settled. failures:", fetchFailures, "of", okSites.length)

      const siteAggregates = []
      for (const [i, data] of results.entries()) {
        if (!data || !data.tiles || data.tiles.features.length === 0) continue
        const features = data.tiles.features
        const peak = features.reduce((best, f) => (f.properties.probability > best.properties.probability ? f : best))
        const [lon, lat] = peak.geometry.coordinates

        // The API doesn't give us the radar station's own coordinates, so we
        // approximate it as the centroid of all its tiles - a full volume
        // scan covers a roughly symmetric circle around the site itself.
        let sumLat = 0
        let sumLon = 0
        for (const f of features) {
          sumLon += f.geometry.coordinates[0]
          sumLat += f.geometry.coordinates[1]
        }
        const siteLat = sumLat / features.length
        const siteLon = sumLon / features.length

        siteAggregates.push({
          site: okSites[i].site,
          lat,
          lon,
          siteLat,
          siteLon,
          probability: peak.properties.probability,
          radarImageUrl: data.radar_image_url,
          radarImageBounds: data.radar_image_bounds
        })
      }
      console.log(
        "[national] loadedSites:",
        siteAggregates.length,
        "of",
        okSites.length,
        "peak probabilities:",
        siteAggregates.map((a) => `${a.site}:${a.probability.toFixed(5)}`)
      )
      window.__nationalSiteAggregates = siteAggregates

      this.renderHeat(siteAggregates)

      const probs = siteAggregates.map((a) => a.probability)
      const minProb = probs.length ? Math.min(...probs) : 0
      const maxProb = probs.length ? Math.max(...probs) : 0
      this.showStatus(
        "ok",
        `Showing ${siteAggregates.length} of ${okSites.length} reporting sites ` +
          `(peak prob ${minProb.toFixed(5)}-${maxProb.toFixed(5)})`
      )
    } catch (err) {
      console.error("[national] refresh failed:", err)
      this.showStatus("error", err.message || "Could not load national data.")
    } finally {
      this.toggleHidden(this.loadingTarget, true)
      this.refreshButtonTarget.disabled = false
    }
  }

  renderHeat(siteAggregates) {
    this.clearLayer()

    // Added before the heat layer so reflectivity images render underneath it
    // (same ordering as the single-site view's image-overlay-then-tiles convention).
    for (const a of siteAggregates) {
      if (a.radarImageUrl && a.radarImageBounds) {
        L.imageOverlay(a.radarImageUrl, a.radarImageBounds, { opacity: RADAR_IMAGE_OPACITY }).addTo(
          this.radarImageLayer
        )
      }
    }

    // Scale 0-1 probability to the 0-100 percentage convention HEAT_MAX uses.
    const points = siteAggregates.map((a) => [a.lat, a.lon, a.probability * 100])

    console.log(
      "[national] renderHeat: map size =",
      this.map.getSize(),
      "zoom =",
      this.map.getZoom(),
      "site count =",
      points.length
    )
    try {
      this.heatLayer = L.heatLayer(points, {
        radius: HEAT_RADIUS,
        blur: HEAT_BLUR,
        max: HEAT_MAX,
        minOpacity: HEAT_MIN_OPACITY,
        // Leaflet.heat silently scales weight down by 1/2^min(maxZoom - zoom, 12),
        // where maxZoom defaults to the map's own maxZoom (18). At our default
        // zoom (4) that's a 4096x reduction on top of our explicit `max`. Pinning
        // maxZoom at/below any zoom we'll actually use keeps that exponent at 0
        // so real probability, not zoom level, drives the intensity.
        maxZoom: 0
      }).addTo(this.map)
      console.log("[national] heat layer added. layer =", this.heatLayer)
    } catch (err) {
      console.error("[national] L.heatLayer threw synchronously:", err)
      throw err
    }

    for (const a of siteAggregates) {
      L.circleMarker([a.siteLat, a.siteLon], {
        radius: SITE_MARKER_RADIUS,
        color: "#1e293b",
        weight: 1,
        fillColor: "#f8fafc",
        fillOpacity: 0.9
      })
        .bindTooltip(`${a.site} — peak ${(a.probability * 100).toFixed(2)}%`, { sticky: true })
        .addTo(this.siteMarkersLayer)
    }
  }

  clearLayer() {
    if (this.heatLayer) {
      this.map.removeLayer(this.heatLayer)
      this.heatLayer = null
    }
    this.radarImageLayer.clearLayers()
    this.siteMarkersLayer.clearLayers()
  }

  showStatus(kind, message) {
    const styles = {
      ok: "text-slate-500",
      error: "rounded-md bg-amber-50 px-2 py-1 text-amber-700"
    }
    this.statusTarget.textContent = message
    this.statusTarget.className = `text-xs ${styles[kind]}`
    this.toggleHidden(this.statusTarget, false)
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}
