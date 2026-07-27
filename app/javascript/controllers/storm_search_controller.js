import { Controller } from "@hotwired/stimulus"

const MAX_RESULTS = 50
const FILTER_DEBOUNCE_MS = 100

export default class extends Controller {
  static targets = ["input", "list", "loading", "error"]
  static values = { apiBaseUrl: String }

  connect() {
    this.stormIds = []
    this.activeIndex = -1
    this.debounceTimer = null
    this.fetchStormIds()
  }

  async fetchStormIds() {
    this.inputTarget.disabled = true
    try {
      const res = await fetch(`${this.apiBaseUrlValue}/storms/madis`)
      if (!res.ok) throw new Error(`Failed to load storm list (${res.status})`)
      const data = await res.json()
      this.stormIds = data.storm_ids.map(String)
      this.inputTarget.disabled = false
    } catch (err) {
      this.showError("Could not load storm list. Reload the page to try again.")
    } finally {
      this.toggleHidden(this.loadingTarget, true)
    }
  }

  filter() {
    clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.renderMatches(), FILTER_DEBOUNCE_MS)
  }

  renderMatches() {
    const query = this.inputTarget.value.trim()
    if (!query || this.stormIds.length === 0) {
      this.hideList()
      return
    }

    const allMatches = this.stormIds.filter((id) => id.includes(query))
    const shown = allMatches.slice(0, MAX_RESULTS)
    this.activeIndex = -1
    this.renderList(shown, allMatches.length)
  }

  renderList(shown, totalCount) {
    if (shown.length === 0) {
      this.hideList()
      return
    }
    const items = shown
      .map(
        (id) =>
          `<li role="option" data-storm-id="${id}" data-action="mousedown->storm-search#select"
               class="cursor-pointer select-none px-4 py-2 text-sm text-slate-700 hover:bg-indigo-50">${id}</li>`
      )
      .join("")
    const footer =
      totalCount > shown.length
        ? `<li class="px-4 py-2 text-xs italic text-slate-400">Showing ${shown.length} of ${totalCount} — keep typing to narrow</li>`
        : ""
    this.listTarget.innerHTML = items + footer
    this.toggleHidden(this.listTarget, false)
    this.inputTarget.setAttribute("aria-expanded", "true")
  }

  onKeydown(event) {
    const options = Array.from(this.listTarget.querySelectorAll('[role="option"]'))
    if (options.length === 0) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      this.activeIndex = (this.activeIndex + 1) % options.length
      this.highlight(options)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      this.activeIndex = (this.activeIndex - 1 + options.length) % options.length
      this.highlight(options)
    } else if (event.key === "Enter") {
      event.preventDefault()
      const target = this.activeIndex >= 0 ? options[this.activeIndex] : options[0]
      this.selectStormId(target.dataset.stormId)
    } else if (event.key === "Escape") {
      this.hideList()
    }
  }

  highlight(options) {
    options.forEach((el, i) => {
      const active = i === this.activeIndex
      el.classList.toggle("bg-indigo-50", active)
      el.classList.toggle("text-indigo-700", active)
      el.setAttribute("aria-selected", active)
    })
  }

  select(event) {
    event.preventDefault()
    this.selectStormId(event.currentTarget.dataset.stormId)
  }

  selectStormId(stormId) {
    this.inputTarget.value = stormId
    this.hideList()
    this.dispatch("selected", { detail: { stormId: Number(stormId) } })
  }

  onBlur() {
    this.hideList()
  }

  hideList() {
    this.toggleHidden(this.listTarget, true)
    this.inputTarget.setAttribute("aria-expanded", "false")
    this.activeIndex = -1
  }

  showError(message) {
    this.errorTarget.textContent = message
    this.toggleHidden(this.errorTarget, false)
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}
