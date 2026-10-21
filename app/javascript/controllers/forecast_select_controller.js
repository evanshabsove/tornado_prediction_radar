import { Controller } from "@hotwired/stimulus"
import { formatBinLabel, formatRunLabel } from "lib/forecast_format"

const POLL_INTERVAL_MS = 5 * 60 * 1000
const LATEST = "latest"
const LIVE = "live"
const REPLAY = "replay"

const ACTIVE = ["bg-indigo-600", "text-white"]
const INACTIVE = ["bg-white", "text-slate-700", "hover:bg-slate-50"]

// Picks what the map shows: a live run (newest by default) or a stored replay of
// a past case, and one of the run's two 4-hour bins. Replays are separate from
// live runs in the API, so each mode has its own list endpoint.
export default class extends Controller {
  static targets = ["runSelect", "runLabel", "binButton", "modeButton", "loading", "error"]
  static values = { apiBaseUrl: String }

  connect() {
    this.mode = LIVE
    this.runs = []
    this.latestId = null
    this.selectedId = null
    this.followingLatest = true
    this.bin = 0
    this.renderModeButtons()
    this.fetchRuns()
    this.pollTimer = setInterval(() => {
      if (this.mode === LIVE) this.fetchRuns()
    }, POLL_INTERVAL_MS)
  }

  disconnect() {
    clearInterval(this.pollTimer)
  }

  async fetchRuns() {
    const mode = this.mode
    this.toggleHidden(this.loadingTarget, false)
    try {
      const res = await fetch(`${this.apiBaseUrlValue}/${mode === LIVE ? "forecasts" : "replays"}`)
      if (!res.ok) throw new Error(`Failed to load ${mode} runs (${res.status})`)
      const data = await res.json()
      if (mode !== this.mode) return // user switched mode while this was in flight
      this.toggleHidden(this.errorTarget, true)
      if (mode === LIVE) this.applyForecasts(data)
      else this.applyReplays(data)
    } catch (err) {
      console.error("[forecast-select]", err)
      if (mode === this.mode) this.showError(`Could not load ${mode} runs (${err.message}). Is the forecast API running at ${this.apiBaseUrlValue}?`)
    } finally {
      this.toggleHidden(this.loadingTarget, true)
    }
  }

  applyForecasts({ forecasts, latest_id: latestId }) {
    if (!forecasts || forecasts.length === 0) {
      this.showError("No forecasts have been issued yet. Try again once the scheduler has run.")
      return
    }

    this.runs = forecasts.map((f) => ({ id: f.id, initTime: f.init_time, stale: f.stale }))
    this.latestId = latestId
    // Follow the newest run unless the user picked one that is still in the list.
    if (this.followingLatest || !this.runs.some((r) => r.id === this.selectedId)) {
      this.followingLatest = true
      this.selectedId = latestId
    }

    const latest = this.runs.find((r) => r.id === latestId)
    this.runSelectTarget.replaceChildren(
      new Option(`Latest (${formatRunLabel(latest.initTime)})`, LATEST),
      ...this.runs.map((r) => new Option(formatRunLabel(r.initTime), r.id))
    )
    this.runSelectTarget.value = this.followingLatest ? LATEST : this.selectedId
    this.finishRender()
  }

  // Replays are grouped by the curated case they belong to ("Mayfield 2021", ...).
  applyReplays({ replays, cases }) {
    if (!replays || replays.length === 0) {
      this.runs = []
      this.runSelectTarget.replaceChildren(new Option("No replays stored", ""))
      this.runSelectTarget.disabled = true
      this.showError("No replays are stored. Create them with scripts/09_serving/run_replay.py in the forecast repo.")
      return
    }

    this.runs = replays.map((r) => ({ id: r.id, initTime: r.init_time, stale: null, caseKey: r.case }))
    const groups = []
    const placed = new Set()
    cases.forEach((c) => {
      const members = c.runs.filter((run) => run.available).map((run) => this.runs.find((r) => r.id === run.id)).filter(Boolean)
      if (members.length > 0) groups.push({ label: c.label, runs: members })
      members.forEach((r) => placed.add(r.id))
    })
    const others = this.runs.filter((r) => !placed.has(r.id))
    if (others.length > 0) groups.push({ label: "Other stored replays", runs: others })

    this.runSelectTarget.replaceChildren(
      ...groups.map((g) => {
        const group = document.createElement("optgroup")
        group.label = g.label
        group.append(...g.runs.map((r) => new Option(formatRunLabel(r.initTime), r.id)))
        return group
      })
    )
    if (!this.runs.some((r) => r.id === this.selectedId)) this.selectedId = groups[0].runs[0].id
    this.runSelectTarget.value = this.selectedId
    this.followingLatest = false
    this.finishRender()
  }

  finishRender() {
    this.runSelectTarget.disabled = false
    this.renderBinButtons()
    this.dispatchSelected()
  }

  selectMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (mode === this.mode) return
    this.mode = mode
    this.followingLatest = mode === LIVE
    this.selectedId = null
    this.runs = []
    this.runLabelTarget.textContent = mode === LIVE ? "Model run (UTC)" : "Replay case (UTC)"
    this.runSelectTarget.disabled = true
    this.binButtonTargets.forEach((button) => (button.disabled = true))
    this.toggleHidden(this.errorTarget, true)
    this.renderModeButtons()
    this.fetchRuns()
  }

  selectRun() {
    const value = this.runSelectTarget.value
    this.followingLatest = this.mode === LIVE && value === LATEST
    this.selectedId = this.followingLatest ? this.latestId : value
    this.renderBinButtons()
    this.dispatchSelected()
  }

  selectBin(event) {
    this.bin = Number(event.currentTarget.dataset.bin)
    this.renderBinButtons()
    this.dispatchSelected()
  }

  refresh() {
    this.fetchRuns()
  }

  renderModeButtons() {
    this.modeButtonTargets.forEach((button) => {
      const active = button.dataset.mode === this.mode
      button.setAttribute("aria-pressed", active)
      button.classList.remove(...ACTIVE, ...INACTIVE)
      button.classList.add(...(active ? ACTIVE : INACTIVE))
    })
  }

  renderBinButtons() {
    const initTime = this.currentRun().initTime
    this.binButtonTargets.forEach((button) => {
      const bin = Number(button.dataset.bin)
      const active = bin === this.bin
      button.textContent = formatBinLabel(initTime, bin)
      button.disabled = false
      button.setAttribute("aria-pressed", active)
      button.classList.remove(...ACTIVE, ...INACTIVE)
      button.classList.add(...(active ? ACTIVE : INACTIVE))
    })
  }

  currentRun() {
    return this.runs.find((r) => r.id === this.selectedId)
  }

  dispatchSelected() {
    const run = this.currentRun()
    this.dispatch("selected", {
      detail: {
        mode: this.mode,
        id: run.id,
        initTime: run.initTime,
        bin: this.bin,
        stale: run.stale,
        latest: this.mode === LIVE && run.id === this.latestId
      }
    })
  }

  showError(message) {
    this.errorTarget.textContent = message
    this.toggleHidden(this.errorTarget, false)
  }

  toggleHidden(el, hidden) {
    el.classList.toggle("hidden", hidden)
  }
}
