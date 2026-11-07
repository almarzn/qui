/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { describe, expect, it } from "vitest"

import type { SpaceNode, SpaceTorrent } from "../types"
import {
  activeQuickFilter,
  applyQuickFilter,
  crossSeedCount,
  daysSince,
  EMPTY_FILTER_INPUTS,
  EMPTY_SPACE_FILTERS,
  filterTree,
  barSegments,
  flattenTree,
  formatDurationShort,
  nodeCheckState,
  nodesCheckState,
  parseFilterInputs,
  parseFilterNumber,
  partitionNodes,
  reclaimableDisplay,
  seedingState,
  sizeBar,
  sortTree,
  toggleNodes,
  visibleSelection,
  type SpaceFilters
} from "./space-tree"

const NOW = Date.parse("2026-06-01T00:00:00Z")
const DAY = 86_400

function isoDaysAgo(days: number): string {
  return new Date(NOW - days * DAY * 1000).toISOString()
}

function torrent(isCrossSeed = false): SpaceTorrent {
  return {
    instanceId: 1,
    instanceName: "qbit",
    hash: isCrossSeed ? "b" : "a",
    name: "Invented.Release-GRP",
    tracker: "tracker.example",
    savePath: "/downloads",
    contentPath: "/downloads/Invented.Release-GRP",
    sizeBytes: 1,
    uploaded: 0,
    downloaded: 0,
    ratio: 0,
    seedingTimeSeconds: 0,
    state: "stalledUP",
    isCrossSeed,
  }
}

function node(id: string, overrides: Partial<SpaceNode> = {}): SpaceNode {
  return {
    id,
    kind: "movie",
    title: id,
    sizeBytes: 0,
    reclaimableBytes: 0,
    reclaimableKnown: true,
    libraryPaths: [],
    downloadPaths: [],
    files: [],
    torrents: [torrent()],
    stats: { uploaded: 0, downloaded: 0, ratio: 0, seedingTimeSeconds: 0 },
    ...overrides,
  }
}

function season(id: string, overrides: Partial<SpaceNode> = {}): SpaceNode {
  return node(id, { kind: "season", ...overrides })
}

const filters = (patch: Partial<SpaceFilters>): SpaceFilters => ({ ...EMPTY_SPACE_FILTERS, ...patch })

// Invented titles only.
const lowRatioSeason = season("s1", { title: "Season 1", stats: { uploaded: 1, downloaded: 10, ratio: 0.1, seedingTimeSeconds: 40 * DAY, lastActivity: isoDaysAgo(60) } })
const highRatioSeason = season("s2", { title: "Season 2", stats: { uploaded: 30, downloaded: 10, ratio: 3, seedingTimeSeconds: 2 * DAY, lastActivity: isoDaysAgo(1) } })
const series = node("series", {
  kind: "series",
  title: "The Copper Lantern",
  sizeBytes: 300,
  children: [lowRatioSeason, highRatioSeason],
})
const movie = node("movie", {
  title: "Harbor of Glass",
  sizeBytes: 500,
  reclaimableBytes: 100,
  torrents: [torrent(), torrent(true)],
  stats: { uploaded: 50, downloaded: 10, ratio: 5, seedingTimeSeconds: 100 * DAY, lastActivity: isoDaysAgo(3) },
})
const unseeded = node("unseeded", { title: "Quiet Meadow", sizeBytes: 200, torrents: [] })
const orphan = node("orphan", { kind: "orphanTorrent", title: "Stray Upload", sizeBytes: 50 })

describe("filterTree", () => {
  it("returns the input when no filter is active", () => {
    const nodes = [series, movie]
    expect(filterTree(nodes, EMPTY_SPACE_FILTERS, NOW)).toBe(nodes)
  })

  it("keeps every season when the series title matches the search", () => {
    expect(filterTree([series, movie], filters({ search: "copper" }), NOW)).toEqual([series])
  })

  it("keeps only matching seasons when a season title matches", () => {
    const result = filterTree([series, movie], filters({ search: "season 2" }), NOW)
    expect(result[0].children?.map(child => child.id)).toEqual(["s2"])
  })

  it("applies the ratio filter to seeded leaves only", () => {
    const result = filterTree([series, movie, unseeded], filters({ ratioBelow: 1 }), NOW)
    expect(result.map(n => n.id)).toEqual(["series"])
    expect(result[0].children?.map(child => child.id)).toEqual(["s1"])
    expect(filterTree([series], filters({ ratioBelow: 0.05 }), NOW)).toEqual([])
  })

  it("filters by seeding time in days", () => {
    const result = filterTree([series, movie, unseeded], filters({ seedingLongerThanDays: 30 }), NOW)
    expect(result.map(n => n.id)).toEqual(["series", "movie"])
    expect(result[0].children?.map(child => child.id)).toEqual(["s1"])
  })

  it("treats a seeded item without recorded activity as inactive", () => {
    const result = filterTree([series, movie, orphan, unseeded], filters({ inactiveForDays: 30 }), NOW)
    expect(result.map(n => n.id)).toEqual(["series", "orphan"])
  })

  it("keeps only items nothing seeds", () => {
    expect(filterTree([series, movie, unseeded, orphan], filters({ notSeeded: true }), NOW).map(n => n.id)).toEqual(["unseeded"])
  })
})

describe("seedingState", () => {
  it("orders not seeded over inactive over low ratio", () => {
    expect(seedingState(unseeded, NOW)).toBe("notSeeded")
    expect(seedingState(lowRatioSeason, NOW)).toBe("inactive")
    expect(seedingState(node("x", { stats: { uploaded: 0, downloaded: 1, ratio: 0.5, seedingTimeSeconds: 1, lastActivity: isoDaysAgo(2) } }), NOW)).toBe("lowRatio")
    expect(seedingState(highRatioSeason, NOW)).toBe("healthy")
  })

  it("counts cross-seeds", () => {
    expect(crossSeedCount(movie)).toBe(1)
    expect(crossSeedCount(unseeded)).toBe(0)
  })
})

describe("quick filters", () => {
  it("replaces the stat filters and keeps the search", () => {
    const inputs = { ...EMPTY_FILTER_INPUTS, search: "lantern", ratioBelow: "2" }
    expect(applyQuickFilter(inputs, "inactive")).toEqual({ ...EMPTY_FILTER_INPUTS, search: "lantern", inactiveForDays: "30" })
    expect(applyQuickFilter(inputs, "all")).toEqual({ ...EMPTY_FILTER_INPUTS, search: "lantern" })
  })

  it("names the preset the inputs match, or null for a custom mix", () => {
    expect(activeQuickFilter(EMPTY_FILTER_INPUTS)).toBe("all")
    expect(activeQuickFilter({ ...EMPTY_FILTER_INPUTS, search: "x", ratioBelow: "1" })).toBe("lowRatio")
    expect(activeQuickFilter({ ...EMPTY_FILTER_INPUTS, notSeeded: true })).toBe("notSeeded")
    expect(activeQuickFilter({ ...EMPTY_FILTER_INPUTS, ratioBelow: "0.5" })).toBeNull()
  })
})

describe("sortTree", () => {
  it("sorts every level by size", () => {
    expect(sortTree([series, movie, orphan], { key: "size", direction: "desc" }).map(n => n.id)).toEqual(["movie", "series", "orphan"])
  })

  it("sorts children and breaks ties by title", () => {
    const a = season("a", { title: "Season 2", reclaimableBytes: 5 })
    const b = season("b", { title: "Season 1", reclaimableBytes: 5 })
    const c = season("c", { title: "Season 3", reclaimableBytes: 9 })
    const [sorted] = sortTree([node("p", { kind: "series", children: [a, b, c] })], { key: "reclaimable", direction: "asc" })
    expect(sorted.children?.map(n => n.id)).toEqual(["b", "a", "c"])
  })
})

describe("flattenTree", () => {
  const sections = partitionNodes([series, movie, orphan])

  it("emits section rows and hides collapsed series children", () => {
    const rows = flattenTree(sections, new Set(), new Set())
    expect(rows.map(r => r.id)).toEqual(["section:library", "series", "movie", "section:orphans", "orphan"])
  })

  it("shows seasons of an expanded series one level deeper and ignores expanded leaves", () => {
    const rows = flattenTree(sections, new Set(["series", "movie"]), new Set())
    expect(rows.map(r => r.id)).toEqual(["section:library", "series", "s1", "s2", "movie", "section:orphans", "orphan"])
    const movieRow = rows[4]
    expect(movieRow.type === "node" && movieRow.expanded).toBe(false)
  })

  it("hides the nodes of a collapsed section", () => {
    expect(flattenTree(sections, new Set(), new Set(["orphans"])).map(r => r.id))
      .toEqual(["section:library", "series", "movie", "section:orphans"])
  })
})

describe("sizeBar", () => {
  it("sizes the bar to the largest item and the solid part to the reclaimable bytes", () => {
    expect(sizeBar(movie, 1000)).toEqual({ totalPct: 50, reclaimablePct: 10 })
    expect(sizeBar(movie, 0)).toEqual({ totalPct: 0, reclaimablePct: 0 })
    expect(sizeBar(node("big", { sizeBytes: 10, reclaimableBytes: 50 }), 10)).toEqual({ totalPct: 100, reclaimablePct: 100 })
  })
})

describe("barSegments", () => {
  it("splits a series bar by season size, in order, and skips empty seasons", () => {
    const a = season("a", { sizeBytes: 300, reclaimableBytes: 150 })
    const b = season("b", { sizeBytes: 100, reclaimableBytes: 500 })
    const empty = season("empty")
    const segments = barSegments(node("series", { kind: "series", sizeBytes: 380, children: [a, empty, b] }))
    expect(segments.map(s => [s.node.id, s.widthPct, s.reclaimablePct])).toEqual([["a", 75, 50], ["b", 25, 100]])
  })

  it("returns no segments for a movie or a series without sized seasons", () => {
    expect(barSegments(movie)).toEqual([])
    expect(barSegments(node("series", { kind: "series", children: [season("empty")] }))).toEqual([])
  })
})

describe("selection", () => {
  it("selects all visible seasons when a series is toggled, and clears them on a second toggle", () => {
    const selected = toggleNodes(new Set(), [series])
    expect([...selected].sort()).toEqual(["s1", "s2"])
    expect(nodeCheckState(series, selected)).toBe(true)
    expect(toggleNodes(selected, [series]).size).toBe(0)
  })

  it("reports a partially selected series as indeterminate", () => {
    expect(nodeCheckState(series, new Set(["s1"]))).toBe("indeterminate")
  })

  it("only selects the seasons a filter left visible", () => {
    const [filtered] = filterTree([series], filters({ ratioBelow: 1 }), NOW)
    expect([...toggleNodes(new Set(), [filtered])]).toEqual(["s1"])
  })

  it("derives the select-all state across roots", () => {
    expect(nodesCheckState([series, movie], new Set())).toBe(false)
    expect(nodesCheckState([series, movie], new Set(["movie"]))).toBe("indeterminate")
    expect(nodesCheckState([series, movie], new Set(["s1", "s2", "movie"]))).toBe(true)
  })

  it("returns only visible selected leaves, in tree order", () => {
    const selected = new Set(["movie", "s2", "s1", "gone"])
    expect(visibleSelection([series, movie], selected).map(n => n.id)).toEqual(["s1", "s2", "movie"])
  })
})

describe("formatting", () => {
  it("marks reclaimable bytes as known, a lower bound, or unknown", () => {
    expect(reclaimableDisplay(0, true)).toEqual({ kind: "known", bytes: 0 })
    expect(reclaimableDisplay(1024, false)).toEqual({ kind: "atLeast", bytes: 1024 })
    expect(reclaimableDisplay(0, false)).toEqual({ kind: "unknown" })
  })

  it("keeps the two largest duration units", () => {
    expect(formatDurationShort(133 * DAY + 5 * 3600 + 35 * 60 + 3)).toBe("133d 5h")
    expect(formatDurationShort(5 * 3600 + 12 * 60 + 9)).toBe("5h 12m")
    expect(formatDurationShort(2 * DAY + 30)).toBe("2d")
    expect(formatDurationShort(42)).toBe("42s")
    expect(formatDurationShort(0)).toBe("0s")
  })

  it("counts whole days since a timestamp", () => {
    expect(daysSince(isoDaysAgo(3), NOW)).toBe(3)
    expect(daysSince(undefined, NOW)).toBeNull()
    expect(daysSince("not a date", NOW)).toBeNull()
    expect(daysSince("0001-01-01T00:00:00Z", NOW)).toBeNull()
  })

  it("parses filter inputs and turns invalid numbers off", () => {
    expect(parseFilterNumber("0,5")).toBe(0.5)
    expect(parseFilterNumber("-1")).toBeNull()
    expect(parseFilterInputs({ ...EMPTY_FILTER_INPUTS, ratioBelow: "0.5", inactiveForDays: "x", notSeeded: true }))
      .toEqual({ ...EMPTY_SPACE_FILTERS, ratioBelow: 0.5, notSeeded: true })
  })
})
