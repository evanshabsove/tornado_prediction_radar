import { Controller } from "@hotwired/stimulus"
import { TIERS, NO_COVERAGE } from "lib/forecast_tiers"
import { formatPercent } from "lib/forecast_format"

// Renders /tiers: what each tier means and the measured evidence behind it.
// Every number comes from the API; none are hardcoded here.
export default class extends Controller {
  static targets = ["loading", "error", "list", "row", "evidence"]
  static values = { apiBaseUrl: String }

  connect() {
    this.fetchTiers()
  }

  async fetchTiers() {
    try {
      const res = await fetch(`${this.apiBaseUrlValue}/tiers`)
      if (!res.ok) throw new Error(`Failed to load tier definitions (${res.status})`)
      this.render(await res.json())
    } catch (err) {
      console.error("[forecast-legend]", err)
      this.errorTarget.textContent = "Could not load the tier legend."
      this.errorTarget.classList.remove("hidden")
    } finally {
      this.loadingTarget.classList.add("hidden")
    }
  }

  render(data) {
    const rows = [...data.tiers].reverse().map((tier) => this.buildRow(tier.code, tier.name, tier.description, tier))
    const none = data.no_coverage
    rows.push(this.buildRow(NO_COVERAGE, none.name, none.description))
    this.listTarget.replaceChildren(...rows)
    this.renderEvidence(data)
  }

  buildRow(code, name, description, evidence) {
    const row = this.rowTarget.content.firstElementChild.cloneNode(true)
    const swatch = row.querySelector("[data-field=swatch]")
    swatch.style.backgroundColor = TIERS[code].color
    swatch.style.opacity = TIERS[code].legendOpacity
    row.querySelector("[data-field=name]").textContent = name
    row.querySelector("[data-field=description]").textContent = description

    const stats = row.querySelector("[data-field=stats]")
    if (evidence) {
      const [low, high] = evidence.hit_rate_ci95
      stats.textContent =
        `Hit rate ${formatPercent(evidence.hit_rate)} (${formatPercent(low)}–${formatPercent(high)}) · ` +
        `${formatPercent(evidence.area_share)} of cells · holds ${formatPercent(evidence.capture_share)} of tornado cells`
    } else {
      stats.remove()
    }
    return row
  }

  renderEvidence({ tiers, basis }) {
    const high = tiers.find((t) => t.name === "High")
    const low = tiers.find((t) => t.name === "Low")
    const era = basis.high_hit_rate_by_era
    const eras = Object.entries(era).map(([years, rate]) => `about ${formatPercent(rate)} in ${years.replace("-", "–")}`)
    const lines = [
      `In past forecasts, about ${formatPercent(high.hit_rate)} of High cells had a tornado within ~40 km in that 4-hour window (${eras.join(", ")}). ` +
        `This is a historical rate for the tier, not the chance for any one forecast. It was measured on a ${basis.ensemble}.`,
      `A Low cell is not a safe cell: ${formatPercent(low.capture_share)} of tornado cells fell in Low.`,
      "An empty High tier is normal: most runs show no High cells."
    ]
    this.evidenceTarget.replaceChildren(
      ...lines.map((line) => {
        const p = document.createElement("p")
        p.textContent = line
        return p
      })
    )
  }
}
