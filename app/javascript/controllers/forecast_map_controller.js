import { Controller } from "@hotwired/stimulus"
import L from "leaflet"
import { TIERS, HIGH, ELEVATED, LOW, NO_COVERAGE, cellStyle } from "lib/forecast_tiers"
import { ageSeconds, formatAge, formatRunLabel, formatWindow } from "lib/forecast_format"
import { efColor, reportPopup } from "lib/forecast_reports"

const DEFAULT_CENTER = [39.8, -98.5]
const DEFAULT_ZOOM = 4
const AGE_TICK_MS = 30 * 1000

const BADGES = {
  current: { text: "Current", classes: "bg-emerald-50 text-emerald-700" },
  older: { text: "Older run — a newer one is available", classes: "bg-slate-100 text-slate-600" },
  stale: { text: "Stale", classes: "bg-amber-50 text-amber-700" },
  retrospective: { text: "Retrospective replay", classes: "bg-violet-100 text-violet-700" }
}
const BADGE_CLASSES = Object.values(BADGES).flatMap((b) => b.classes.split(" "))

// The grid is ~11k cells and Leaflet's SVG renderer would create one DOM node
// per cell, so cells are polygons on a single canvas (`preferCanvas`). They are
// non-interactive; hover is a lookup over precomputed cell bounds instead,
// because per-layer hit-testing on 11k canvas paths is slow.
export default class extends Controller {
  static targets = [
    "map", "loading", "error", "validWindow", "issued", "age", "badge",
    "model", "tierCounts", "noHighNote", "retrospectiveNote"
  ]
  static values = { apiBaseUrl: String }

  connect() {
    this.map = L.map(this.mapTarget, { preferCanvas: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18
    }).addTo(this.map)
    this.renderer = L.canvas({ padding: 0.5 })
    this.tooltip = L.tooltip({ direction: "top", offset: [0, -4], opacity: 0.95 })
    this.outline = L.polygon([], { color: "#0f172a", weight: 2, fill: false, interactive: false, renderer: this.renderer })

    // SPC reports are few, so they get a normal SVG layer in their own pane above the cell canvas.
    this.map.createPane("reports").style.zIndex = 450
    this.reportRenderer = L.svg({ pane: "reports" })
    this.reportsLayer = null

    this.grid = null
    this.gridPromise = null
    this.cells = null // one Leaflet polygon per cell, created on first render
    this.drawnTiers = null
    this.forecast = null
    this.selection = null
    this.renderedKey = null
    this.loadToken = 0

    this.map.on("mousemove click", (e) => this.queueHover(e.latlng))
    this.map.on("mouseout", () => this.clearHover())
    this.ageTimer = setInterval(() => this.updateAge(), AGE_TICK_MS)
    this.mode = "live"

    this.ensureGrid().catch(() => {}) // warm the grid while the run list loads; errors surface on first selection
  }

  disconnect() {
    clearInterval(this.ageTimer)
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame)
    if (this.map) {
      this.map.remove()
      this.map = null
    }
  }

  async onSelected(event) {
    const { mode, id, bin, stale, latest } = event.detail
    this.selection = { mode, id, bin, stale, latest }

    const key = `${mode}:${id}:${bin}`
    if (key === this.renderedKey) {
      this.updateBadge() // same run and bin: a poll only changes freshness
      return
    }

    const token = ++this.loadToken
    this.toggleHidden(this.loadingTarget, false)
    this.toggleHidden(this.errorTarget, true)
    try {
      const forecast = await this.fetchForecast(mode, id)
      let grid = await this.ensureGrid()
      if (forecast.grid_id !== grid.grid_id) grid = await this.ensureGrid({ reload: true })
      if (forecast.grid_id !== grid.grid_id) throw new Error("The forecast was made on a different grid than the one served.")
      if (token !== this.loadToken) return // user picked something else while this was in flight

      this.forecast = forecast
      this.renderedKey = key
      this.render()
    } catch (err) {
      if (token === this.loadToken) this.showError(err.message)
    } finally {
      if (token === this.loadToken) this.toggleHidden(this.loadingTarget, true)
    }
  }

  // Live runs and replays are separate namespaces in the API: an id is only valid under its own route.
  async fetchForecast(mode, id) {
    const route = mode === "replay" ? "replay" : "forecast"
    const res = await fetch(`${this.apiBaseUrlValue}/${route}/${encodeURIComponent(id)}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Could not load ${route} ${id} (${res.status})`)
    }
    return res.json()
  }

  // The grid never changes unless its grid_id does, so it is fetched once.
  // `reload` bypasses the browser's day-long cache after a grid_id mismatch.
  ensureGrid({ reload = false } = {}) {
    if (!this.gridPromise || reload) {
      this.gridPromise = fetch(`${this.apiBaseUrlValue}/grid`, reload ? { cache: "reload" } : {})
        .then((res) => {
          if (!res.ok) throw new Error(`Could not load the forecast grid (${res.status})`)
          return res.json()
        })
        .then((grid) => this.applyGrid(grid))
        .catch((err) => {
          this.gridPromise = null
          throw err
        })
    }
    return this.gridPromise
  }

  applyGrid(grid) {
    if (this.grid?.grid_id === grid.grid_id) return this.grid
    this.grid = grid

    // Cell (row, col) corners, from the shared vertex lattice: SW, SE, NE, NW.
    const [rows, cols] = grid.shape
    const vertexCols = grid.vertex_shape[1]
    const { lat, lon } = grid.vertices
    this.cellRings = new Array(rows * cols)
    this.cellBounds = new Float64Array(rows * cols * 4) // minLat, maxLat, minLon, maxLon
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const v = row * vertexCols + col
        const corners = [v, v + 1, v + vertexCols + 1, v + vertexCols]
        const ring = corners.map((k) => [lat[k], lon[k]])
        const i = row * cols + col
        this.cellRings[i] = ring
        const lats = ring.map((p) => p[0])
        const lons = ring.map((p) => p[1])
        this.cellBounds.set([Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)], i * 4)
      }
    }

    if (this.cells) this.cells.forEach((cell) => cell.remove())
    this.cells = null
    this.drawnTiers = null
    this.renderedKey = null

    const bounds = L.latLngBounds(Array.from(lat, (la, k) => [la, lon[k]]))
    this.map.fitBounds(bounds)
    return grid
  }

  render() {
    const bin = this.forecast.bins.find((b) => b.bin_index === this.selection.bin)
    if (!bin) {
      this.showError(`This forecast has no bin ${this.selection.bin}.`)
      return
    }

    this.drawTiers(bin.tiers)
    this.clearHover()
    this.tiers = bin.tiers

    const { model, tiering } = this.forecast
    this.mode = this.selection.mode
    this.validWindowTarget.textContent = formatWindow(bin.valid_start, bin.valid_end)
    this.issuedTarget.textContent =
      this.mode === "replay"
        ? `Run ${formatRunLabel(this.forecast.init_time)} · replay computed ${formatRunLabel(this.forecast.generated_at)}`
        : `Run ${formatRunLabel(this.forecast.init_time)} · generated ${formatRunLabel(this.forecast.generated_at)}`
    this.retrospectiveNoteTarget.textContent = this.forecast.note || ""
    this.toggleHidden(this.retrospectiveNoteTarget, this.mode !== "replay")
    this.modelTarget.textContent =
      `${model.n_members}-member ensemble · trained ${model.trained_years.first}–${model.trained_years.last} · tier set ${tiering.tier_set_id}`
    this.updateAge()
    this.updateBadge()
    this.updateTierCounts(bin.tiers)
  }

  drawTiers(tiers) {
    if (!this.cells) {
      this.cells = tiers.map((tier, i) => L.polygon(this.cellRings[i], { ...cellStyle(tier), renderer: this.renderer }))
      L.layerGroup(this.cells).addTo(this.map)
    } else {
      tiers.forEach((tier, i) => {
        if (tier !== this.drawnTiers[i]) this.cells[i].setStyle(cellStyle(tier))
      })
    }
    this.drawnTiers = tiers
  }

  updateTierCounts(tiers) {
    const counts = { [HIGH]: 0, [ELEVATED]: 0, [LOW]: 0, [NO_COVERAGE]: 0 }
    tiers.forEach((tier) => counts[tier]++)
    this.tierCountsTarget.textContent = [HIGH, ELEVATED, LOW, NO_COVERAGE]
      .map((tier) => `${TIERS[tier].name} ${counts[tier].toLocaleString()}`)
      .join(" · ")
    this.toggleHidden(this.noHighNoteTarget, counts[HIGH] > 0)
  }

  updateAge() {
    if (!this.forecast) return
    // A replay's run is years old, so its age and staleness mean nothing.
    if (this.mode === "replay") {
      this.ageTarget.textContent = ""
      return
    }
    this.ageTarget.textContent = `Run is ${formatAge(ageSeconds(this.forecast.init_time))} old`
  }

  updateBadge() {
    const { mode, stale, latest } = this.selection
    const badge = mode === "replay" ? BADGES.retrospective : stale ? BADGES.stale : latest ? BADGES.current : BADGES.older
    this.badgeTarget.textContent = badge.text
    this.badgeTarget.classList.remove(...BADGE_CLASSES)
    this.badgeTarget.classList.add(...badge.classes.split(" "))
    this.toggleHidden(this.badgeTarget, false)
  }

  onReportsLoaded(event) {
    this.onReportsCleared()
    const { features } = event.detail.geojson
    const tracks = features.filter((f) => f.properties.kind === "track")
    const touchdowns = features.filter((f) => f.properties.kind === "touchdown")
    const options = { pane: "reports", renderer: this.reportRenderer }
    const popup = (feature, layer) => layer.bindPopup(reportPopup(feature.properties))

    // Tracks get a white casing so they read over the red/amber tier fills.
    const casing = L.geoJSON(tracks, { style: () => ({ ...options, color: "#ffffff", weight: 6, opacity: 0.85, interactive: false }) })
    const lines = L.geoJSON(tracks, {
      style: (f) => ({ ...options, color: efColor(f.properties.ef_rating), weight: 3, opacity: 1 }),
      onEachFeature: popup
    })
    const points = L.geoJSON(touchdowns, {
      pointToLayer: (f, latlng) =>
        L.circleMarker(latlng, { ...options, radius: 6, color: "#ffffff", weight: 2, fillColor: efColor(f.properties.ef_rating), fillOpacity: 1 }),
      onEachFeature: popup
    })
    this.reportsLayer = L.layerGroup([casing, lines, points]).addTo(this.map)
  }

  onReportsCleared() {
    if (this.reportsLayer) {
      this.reportsLayer.remove()
      this.reportsLayer = null
    }
  }

  queueHover(latlng) {
    if (this.hoverFrame) return
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = null
      this.showHover(latlng)
    })
  }

  showHover(latlng) {
    if (!this.map || !this.tiers) return
    const i = this.cellAt(latlng.lat, latlng.lng)
    if (i < 0) {
      this.clearHover()
      return
    }

    const tier = this.tiers[i]
    const text = document.createElement("div")
    if (tier === NO_COVERAGE) {
      const country = this.grid.country_codes[this.grid.country[i]]
      text.textContent = `${country}: no model coverage`
    } else {
      text.textContent = `${TIERS[tier].name}: ${TIERS[tier].hover}`
    }
    this.outline.setLatLngs(this.cellRings[i])
    if (!this.map.hasLayer(this.outline)) this.outline.addTo(this.map)
    this.tooltip.setLatLng(latlng).setContent(text)
    if (!this.map.hasLayer(this.tooltip)) this.tooltip.addTo(this.map)
  }

  clearHover() {
    if (!this.map) return
    this.outline.remove()
    this.tooltip.remove()
  }

  // Index of the cell containing the point, or -1. A cheap bounding-box test
  // first, then a ray cast on the few cells whose boxes overlap (cells are
  // slightly rotated quads, so neighbouring boxes overlap).
  cellAt(lat, lng) {
    const b = this.cellBounds
    for (let i = 0; i < this.cellRings.length; i++) {
      const o = i * 4
      if (lat < b[o] || lat > b[o + 1] || lng < b[o + 2] || lng > b[o + 3]) continue
      if (pointInRing(lat, lng, this.cellRings[i])) return i
    }
    return -1
  }

  showError(message) {
    this.errorTarget.textContent = message
    this.toggleHidden(this.errorTarget, false)
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}

function pointInRing(lat, lng, ring) {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [latA, lngA] = ring[a]
    const [latB, lngB] = ring[b]
    if ((lngA > lng) !== (lngB > lng) && lat < ((latB - latA) * (lng - lngA)) / (lngB - lngA) + latA) {
      inside = !inside
    }
  }
  return inside
}
