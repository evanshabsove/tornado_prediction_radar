import { Controller } from "@hotwired/stimulus"
import { binWindow } from "lib/forecast_format"
import { EF_COLORS, UNRATED_COLOR, efLabel } from "lib/forecast_reports"

// Fetches SPC tornado reports for the selected replay bin and hands them to the
// map as a `forecast-reports:loaded` event; the map owns drawing. Live runs have
// no verifying reports (the archive ends in 2025), so the panel only shows for replays.
export default class extends Controller {
  static targets = ["panel", "toggle", "status", "loading", "error", "legend"]
  static values = { apiBaseUrl: String }

  connect() {
    this.selection = null
    this.loadToken = 0
    this.renderLegend()
  }

  onSelected(event) {
    this.selection = event.detail
    if (this.selection.mode !== "replay") {
      this.toggleHidden(this.panelTarget, true)
      this.clear()
      return
    }

    this.toggleHidden(this.panelTarget, false)
    if (this.toggleTarget.checked) this.load()
    else this.clear()
  }

  toggle() {
    if (!this.selection || this.selection.mode !== "replay") return
    if (this.toggleTarget.checked) this.load()
    else this.clear()
  }

  async load() {
    const { initTime, bin } = this.selection
    const { start, end } = binWindow(initTime, bin)
    const token = ++this.loadToken
    this.toggleHidden(this.loadingTarget, false)
    this.toggleHidden(this.errorTarget, true)
    try {
      const params = new URLSearchParams({ start, end })
      const res = await fetch(`${this.apiBaseUrlValue}/reports?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Could not load SPC reports (${res.status})`)
      }
      const geojson = await res.json()
      if (token !== this.loadToken) return // selection changed while this was in flight

      this.statusTarget.textContent =
        geojson.count === 0
          ? "No SPC tornado reports touched down in this window."
          : `${geojson.count} SPC tornado report${geojson.count === 1 ? "" : "s"} touched down in this window.`
      this.dispatch("loaded", { detail: { geojson } })
    } catch (err) {
      console.error("[forecast-reports]", err)
      if (token === this.loadToken) {
        this.clear()
        this.errorTarget.textContent = err.message
        this.toggleHidden(this.errorTarget, false)
      }
    } finally {
      if (token === this.loadToken) this.toggleHidden(this.loadingTarget, true)
    }
  }

  clear() {
    this.loadToken++ // drop any request still in flight
    this.statusTarget.textContent = ""
    this.toggleHidden(this.loadingTarget, true)
    this.toggleHidden(this.errorTarget, true)
    this.dispatch("cleared")
  }

  renderLegend() {
    const swatch = (color, label) => {
      const item = document.createElement("li")
      item.className = "flex items-center gap-1"
      const dot = document.createElement("span")
      dot.className = "inline-block h-3 w-3 rounded-full border border-slate-400"
      dot.style.backgroundColor = color
      item.append(dot, document.createTextNode(label))
      return item
    }
    this.legendTarget.replaceChildren(
      ...Object.entries(EF_COLORS).map(([rating, color]) => swatch(color, efLabel(Number(rating)))),
      swatch(UNRATED_COLOR, efLabel(null))
    )
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}
