/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { describe, expect, it } from "vitest"

import type { SpaceNode } from "../types"
import {
  daysSince,
  EMPTY_FILTER_INPUTS,
  EMPTY_SPACE_FILTERS,
  filterTree,
  flattenTree,
  nodeCheckState,
  nodesCheckState,
  parseFilterInputs,
  parseFilterNumber,
  partitionNodes,
  reclaimableDisplay,
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
    torrents: [],
    stats: { uploaded: 0, downloaded: 0, ratio: 0, seedingTimeSeconds: 0, lastActivity: "" },
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
  stats: { uploaded: 50, downloaded: 10, ratio: 5, seedingTimeSeconds: 100 * DAY, lastActivity: isoDaysAgo(3) },
})
const orphan = node("orphan", { kind: "orphanTorrent", title: "Stray Upload", sizeBytes: 50 })

describe("filterTree", () => {
  it("returns the input when no filter is active", () => {
    const nodes = [series, movie]
    expect(filterTree(nodes, EMPTY_SPACE_FILTERS, NOW)).toBe(nodes)
  })

  it("keeps every season when the series title matches the search", () => {
    const result = filterTree([series, movie], filters({ search: "copper" }), NOW)
    expect(result).toEqual([series])
  })

  it("keeps only matching seasons when a season title matches", () => {
    const result = filterTree([series, movie], filters({ search: "season 2" }), NOW)
    expect(result).toHaveLength(1)
    expect(result[0].children?.map(child => child.id)).toEqual(["s2"])
  })

  it("applies the ratio filter to leaves and drops a series without a passing season", () => {
    const result = filterTree([series, movie], filters({ ratioBelow: 1 }), NOW)
    expect(result.map(n => n.id)).toEqual(["series"])
    expect(result[0].children?.map(child => child.id)).toEqual(["s1"])
    expect(filterTree([series], filters({ ratioBelow: 0.05 }), NOW)).toEqual([])
  })

  it("filters by seeding time in days", () => {
    const result = filterTree([series, movie], filters({ seedingLongerThanDays: 30 }), NOW)
    expect(result.map(n => n.id)).toEqual(["series", "movie"])
    expect(result[0].children?.map(child => child.id)).toEqual(["s1"])
  })

  it("filters by inactivity and treats missing activity as inactive", () => {
    const result = filterTree([series, movie, orphan], filters({ inactiveForDays: 30 }), NOW)
    expect(result.map(n => n.id)).toEqual(["series", "orphan"])
  })

  it("combines search with stat filters", () => {
    expect(filterTree([series], filters({ search: "copper", ratioBelow: 1 }), NOW)[0].children?.map(c => c.id)).toEqual(["s1"])
  })
})

describe("sortTree", () => {
  it("sorts every level by size, descending by default use", () => {
    const sorted = sortTree([series, movie, orphan], { key: "size", direction: "desc" })
    expect(sorted.map(n => n.id)).toEqual(["movie", "series", "orphan"])
  })

  it("sorts children and breaks ties by title", () => {
    const a = season("a", { title: "Season 2", reclaimableBytes: 5 })
    const b = season("b", { title: "Season 1", reclaimableBytes: 5 })
    const c = season("c", { title: "Season 3", reclaimableBytes: 9 })
    const parent = node("p", { kind: "series", children: [a, b, c] })
    const [sorted] = sortTree([parent], { key: "reclaimable", direction: "asc" })
    expect(sorted.children?.map(n => n.id)).toEqual(["b", "a", "c"])
  })

  it("does not mutate the input", () => {
    const input = [orphan, movie]
    sortTree(input, { key: "size", direction: "desc" })
    expect(input.map(n => n.id)).toEqual(["orphan", "movie"])
  })
})

describe("flattenTree", () => {
  const sections = partitionNodes([series, movie, orphan])

  it("emits section rows and hides collapsed series children", () => {
    const rows = flattenTree(sections, new Set(), new Set())
    expect(rows.map(r => r.id)).toEqual(["section:library", "series", "movie", "section:orphans", "orphan"])
    const library = rows[0]
    expect(library.type === "section" && library.sizeBytes).toBe(800)
  })

  it("shows seasons of an expanded series one level deeper", () => {
    const rows = flattenTree(sections, new Set(["series"]), new Set())
    expect(rows.map(r => r.id)).toEqual(["section:library", "series", "s1", "s2", "movie", "section:orphans", "orphan"])
    const s1 = rows[2]
    expect(s1.type === "node" && s1.depth).toBe(1)
  })

  it("hides the nodes of a collapsed section and skips empty sections", () => {
    const rows = flattenTree(sections, new Set(), new Set(["orphans"]))
    expect(rows.map(r => r.id)).toEqual(["section:library", "series", "movie", "section:orphans"])
    expect(flattenTree(partitionNodes([movie]), new Set(), new Set()).map(r => r.id)).toEqual(["section:library", "movie"])
  })
})

describe("selection", () => {
  it("selects all visible seasons when a series is toggled, and clears them on a second toggle", () => {
    const selected = toggleNodes(new Set(), [series])
    expect([...selected].sort()).toEqual(["s1", "s2"])
    expect(nodeCheckState(series, selected)).toBe(true)
    expect(toggleNodes(selected, [series]).size).toBe(0)
  })

  it("reports a partially selected series as indeterminate and completes it on toggle", () => {
    const partial = new Set(["s1"])
    expect(nodeCheckState(series, partial)).toBe("indeterminate")
    expect(nodeCheckState(series, toggleNodes(partial, [series]))).toBe(true)
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
    const filtered = filterTree([series, movie], filters({ ratioBelow: 1 }), NOW)
    expect(visibleSelection(filtered, selected).map(n => n.id)).toEqual(["s1"])
  })
})

describe("reclaimableDisplay", () => {
  it("shows known bytes as-is, including zero", () => {
    expect(reclaimableDisplay(0, true)).toEqual({ kind: "known", bytes: 0 })
    expect(reclaimableDisplay(1024, true)).toEqual({ kind: "known", bytes: 1024 })
  })

  it("marks a partial count as a lower bound and an empty one as unknown", () => {
    expect(reclaimableDisplay(1024, false)).toEqual({ kind: "atLeast", bytes: 1024 })
    expect(reclaimableDisplay(0, false)).toEqual({ kind: "unknown" })
  })
})

describe("helpers", () => {
  it("counts whole days since a timestamp", () => {
    expect(daysSince(isoDaysAgo(3), NOW)).toBe(3)
    expect(daysSince("", NOW)).toBeNull()
    expect(daysSince("not a date", NOW)).toBeNull()
    expect(daysSince("0001-01-01T00:00:00Z", NOW)).toBeNull()
  })

  it("parses filter numbers and turns invalid input off", () => {
    expect(parseFilterNumber("")).toBeNull()
    expect(parseFilterNumber(" 1.5 ")).toBe(1.5)
    expect(parseFilterNumber("0,5")).toBe(0.5)
    expect(parseFilterNumber("-1")).toBeNull()
    expect(parseFilterNumber("abc")).toBeNull()
  })

  it("turns raw filter inputs into filters", () => {
    expect(parseFilterInputs(EMPTY_FILTER_INPUTS)).toEqual(EMPTY_SPACE_FILTERS)
    expect(parseFilterInputs({ search: "lantern", ratioBelow: "0.5", seedingLongerThanDays: "30", inactiveForDays: "x" }))
      .toEqual({ search: "lantern", ratioBelow: 0.5, seedingLongerThanDays: 30, inactiveForDays: null })
  })
})
