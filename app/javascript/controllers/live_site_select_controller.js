import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["select", "loading", "error"]
  static values = { apiBaseUrl: String }

  connect() {
    this.fetchSites()
  }

  async fetchSites() {
    try {
      const res = await fetch(`${this.apiBaseUrlValue}/live/sites`)
      if (!res.ok) throw new Error(`Failed to load site list (${res.status})`)
      const data = await res.json()
      this.renderOptions(data.sites)
    } catch (err) {
      this.showError("Could not load radar sites. Reload the page to try again.")
    } finally {
      this.toggleHidden(this.loadingTarget, true)
    }
  }

  renderOptions(sites) {
    if (!sites || sites.length === 0) {
      this.showError("No radar sites are configured.")
      return
    }

    this.selectTarget.innerHTML = sites
      .map((s) => `<option value="${s.site}">${s.site} — ${s.status}</option>`)
      .join("")
    this.selectTarget.disabled = false

    const defaultSite = sites.find((s) => s.status === "ok") || sites[0]
    this.selectTarget.value = defaultSite.site
    this.dispatchSelected(defaultSite.site)
  }

  select() {
    this.dispatchSelected(this.selectTarget.value)
  }

  dispatchSelected(site) {
    this.dispatch("selected", { detail: { site } })
  }

  showError(message) {
    this.errorTarget.textContent = message
    this.toggleHidden(this.errorTarget, false)
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}
