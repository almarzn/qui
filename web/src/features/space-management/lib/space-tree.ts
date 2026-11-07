/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import type { SpaceNode } from "../types"

// Pure tree logic for the Space Management page: filtering, sorting, flattening for the
// virtualized list, seeding state, and leaf-based selection. Kept free of React so it is unit-testable.

const DAY_SECONDS = 86_400
const DAY_MS = DAY_SECONDS * 1000

/** Below this ratio a seeded item counts as low ratio (quick filter and colour). */
export const LOW_RATIO = 1
/** At least this many idle days make a seeded item inactive (quick filter and colour). */
export const INACTIVE_DAYS = 30

export type SpaceSortKey = "size" | "reclaimable"
export type SpaceSortDirection = "asc" | "desc"

export interface SpaceSort {
  key: SpaceSortKey
  direction: SpaceSortDirection
}

export interface SpaceFilters {
  search: string
  /** Keep seeded nodes whose rolled-up ratio is below this value. */
  ratioBelow: number | null
  /** Keep seeded nodes that have seeded for at least this many days. */
  seedingLongerThanDays: number | null
  /** Keep seeded nodes without activity for at least this many days. */
  inactiveForDays: number | null
  /** Keep only nodes no torrent seeds. */
  notSeeded: boolean
}

export const EMPTY_SPACE_FILTERS: SpaceFilters = {
  search: "",
  ratioBelow: null,
  seedingLongerThanDays: null,
  inactiveForDays: null,
  notSeeded: false,
}

export type SpaceSection = "library" | "orphans"

export function isOrphan(node: SpaceNode): boolean {
  return node.kind === "orphanTorrent" || node.kind === "orphanFile"
}

/** A node is seeded when at least one torrent (main or cross-seed) holds its data. */
export function isSeeded(node: SpaceNode): boolean {
  return node.torrents.length > 0
}

export function crossSeedCount(node: SpaceNode): number {
  return node.torrents.reduce((count, torrent) => count + (torrent.isCrossSeed ? 1 : 0), 0)
}

export function hasActiveFilters(filters: SpaceFilters): boolean {
  return filters.search.trim() !== "" ||
    filters.ratioBelow !== null ||
    filters.seedingLongerThanDays !== null ||
    filters.inactiveForDays !== null ||
    filters.notSeeded
}

/** Whole days since an RFC3339 timestamp, or null when it is missing or unparsable. */
export function daysSince(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (Number.isNaN(time) || time <= 0) return null
  return Math.max(0, Math.floor((nowMs - time) / DAY_MS))
}

function isIdle(node: SpaceNode, days: number, nowMs: number): boolean {
  // No recorded activity at all counts as idle: nothing has touched it.
  const idle = daysSince(node.stats.lastActivity, nowMs)
  return idle === null || idle >= days
}

export type SeedingState = "healthy" | "lowRatio" | "inactive" | "notSeeded"

/** Colour class of a node: not seeded wins over inactive, which wins over low ratio. */
export function seedingState(node: SpaceNode, nowMs: number): SeedingState {
  if (!isSeeded(node)) return "notSeeded"
  if (isIdle(node, INACTIVE_DAYS, nowMs)) return "inactive"
  if (node.stats.ratio < LOW_RATIO) return "lowRatio"
  return "healthy"
}

function matchesSearch(node: SpaceNode, needle: string): boolean {
  if (needle === "") return true
  return node.title.toLowerCase().includes(needle)
}

function matchesStats(node: SpaceNode, filters: SpaceFilters, nowMs: number): boolean {
  const seeded = isSeeded(node)
  if (filters.notSeeded && seeded) return false
  const { stats } = node
  // Torrent stats describe seeding; an item nothing seeds has none to compare.
  if (filters.ratioBelow !== null && !(seeded && stats.ratio < filters.ratioBelow)) return false
  if (filters.seedingLongerThanDays !== null && !(seeded && stats.seedingTimeSeconds >= filters.seedingLongerThanDays * DAY_SECONDS)) {
    return false
  }
  if (filters.inactiveForDays !== null && !(seeded && isIdle(node, filters.inactiveForDays, nowMs))) return false
  return true
}

/**
 * Filters the tree. Stat filters apply to leaves (seasons, movies, orphans); a series stays
 * when at least one of its seasons passes. A series title that matches the search keeps every
 * season that passes the stat filters.
 */
export function filterTree(nodes: SpaceNode[], filters: SpaceFilters, nowMs: number): SpaceNode[] {
  if (!hasActiveFilters(filters)) return nodes
  const needle = filters.search.trim().toLowerCase()
  const result: SpaceNode[] = []

  for (const node of nodes) {
    const children = node.children ?? []
    if (children.length === 0) {
      if (matchesSearch(node, needle) && matchesStats(node, filters, nowMs)) result.push(node)
      continue
    }

    const titleHit = matchesSearch(node, needle)
    const kept = children.filter(child => (titleHit || matchesSearch(child, needle)) && matchesStats(child, filters, nowMs))
    if (kept.length > 0) {
      result.push(kept.length === children.length ? node : { ...node, children: kept })
    }
  }

  return result
}

function sortValue(node: SpaceNode, key: SpaceSortKey): number {
  return key === "size" ? node.sizeBytes : node.reclaimableBytes
}

/** Sorts every level of the tree; ties fall back to the title so the order is stable. */
export function sortTree(nodes: SpaceNode[], sort: SpaceSort): SpaceNode[] {
  const factor = sort.direction === "asc" ? 1 : -1
  return [...nodes]
    .sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * factor || a.title.localeCompare(b.title))
    .map(node => node.children && node.children.length > 0
      ? { ...node, children: sortTree(node.children, sort) }
      : node)
}

export function partitionNodes(nodes: SpaceNode[]): Record<SpaceSection, SpaceNode[]> {
  const library: SpaceNode[] = []
  const orphans: SpaceNode[] = []
  for (const node of nodes) {
    (isOrphan(node) ? orphans : library).push(node)
  }
  return { library, orphans }
}

export type SpaceRow =
  | { type: "section"; id: string; section: SpaceSection; count: number; sizeBytes: number; collapsed: boolean }
  | { type: "node"; id: string; node: SpaceNode; depth: number; hasChildren: boolean; expanded: boolean; offsetBytes: number }

/**
 * Flattens the visible tree into rows for the virtualizer. An expanded series shows its seasons.
 * A child's offsetBytes is where its bar starts: the parent's offset plus the sizes of the
 * siblings above it, so the seasons' bars line up end to end under the series bar.
 */
export function flattenTree(
  sections: Record<SpaceSection, SpaceNode[]>,
  expanded: ReadonlySet<string>,
  collapsedSections: ReadonlySet<SpaceSection>
): SpaceRow[] {
  const rows: SpaceRow[] = []

  const pushNode = (node: SpaceNode, depth: number, offsetBytes: number) => {
    const hasChildren = (node.children?.length ?? 0) > 0
    const isExpanded = hasChildren && expanded.has(node.id)
    rows.push({ type: "node", id: node.id, node, depth, hasChildren, expanded: isExpanded, offsetBytes })
    if (isExpanded) {
      let childOffset = offsetBytes
      for (const child of node.children ?? []) {
        pushNode(child, depth + 1, childOffset)
        childOffset += child.sizeBytes
      }
    }
  }

  for (const section of ["library", "orphans"] as const) {
    const nodes = sections[section]
    if (nodes.length === 0) continue
    const collapsed = collapsedSections.has(section)
    rows.push({
      type: "section",
      id: `section:${section}`,
      section,
      count: nodes.length,
      sizeBytes: nodes.reduce((sum, node) => sum + node.sizeBytes, 0),
      collapsed,
    })
    if (!collapsed) {
      for (const node of nodes) pushNode(node, 0, 0)
    }
  }

  return rows
}

export interface SizeBar {
  /** Where the bar starts, in percent of the largest item. */
  offsetPct: number
  /** Width of the whole bar, in percent of the largest item. */
  totalPct: number
  /** Width of the reclaimable part, in percent of the largest item. */
  reclaimablePct: number
}

/** Bar position and widths for a node next to the largest visible item, starting at offsetBytes. */
export function sizeBar(node: SpaceNode, maxBytes: number, offsetBytes = 0): SizeBar {
  if (maxBytes <= 0 || node.sizeBytes <= 0) return { offsetPct: 0, totalPct: 0, reclaimablePct: 0 }
  const offsetPct = Math.min(100, (Math.max(0, offsetBytes) / maxBytes) * 100)
  const totalPct = Math.min(100 - offsetPct, (node.sizeBytes / maxBytes) * 100)
  const reclaimable = Math.min(node.reclaimableBytes, node.sizeBytes)
  return { offsetPct, totalPct, reclaimablePct: Math.min(totalPct, (Math.max(0, reclaimable) / maxBytes) * 100) }
}

// Selection holds leaf ids only (seasons, movies, orphans, and a series without seasons).
// A parent's checkbox is derived from its visible children.

/** The ids a click on this node selects: its visible leaves, or itself when it has none. */
export function selectableIds(node: SpaceNode): string[] {
  const children = node.children ?? []
  if (children.length === 0) return [node.id]
  return children.flatMap(selectableIds)
}

export type SpaceCheckState = boolean | "indeterminate"

function checkStateFor(ids: string[], selected: ReadonlySet<string>): SpaceCheckState {
  if (ids.length === 0) return false
  let count = 0
  for (const id of ids) if (selected.has(id)) count++
  if (count === 0) return false
  return count === ids.length ? true : "indeterminate"
}

export function nodeCheckState(node: SpaceNode, selected: ReadonlySet<string>): SpaceCheckState {
  return checkStateFor(selectableIds(node), selected)
}

export function nodesCheckState(nodes: SpaceNode[], selected: ReadonlySet<string>): SpaceCheckState {
  return checkStateFor(nodes.flatMap(selectableIds), selected)
}

/** Selects every visible leaf under the nodes, or clears them when all are already selected. */
export function toggleNodes(selected: ReadonlySet<string>, nodes: SpaceNode[]): Set<string> {
  const ids = nodes.flatMap(selectableIds)
  const next = new Set(selected)
  if (checkStateFor(ids, selected) === true) {
    for (const id of ids) next.delete(id)
  } else {
    for (const id of ids) next.add(id)
  }
  return next
}

/**
 * The selected leaves that are still visible, in tree order. A delete acts on these only,
 * so a filter change or a refresh never deletes a row the user cannot see.
 */
export function visibleSelection(nodes: SpaceNode[], selected: ReadonlySet<string>): SpaceNode[] {
  const result: SpaceNode[] = []
  const walk = (node: SpaceNode) => {
    const children = node.children ?? []
    if (children.length === 0) {
      if (selected.has(node.id)) result.push(node)
      return
    }
    children.forEach(walk)
  }
  nodes.forEach(walk)
  return result
}

export type ReclaimableDisplay =
  | { kind: "known"; bytes: number }
  | { kind: "atLeast"; bytes: number }
  | { kind: "unknown" }

/**
 * When the backend could not stat every file (`reclaimableKnown=false`), its byte count is a
 * lower bound: show it as "at least", or as unknown when nothing could be counted.
 */
export function reclaimableDisplay(bytes: number, known: boolean): ReclaimableDisplay {
  if (known) return { kind: "known", bytes }
  return bytes > 0 ? { kind: "atLeast", bytes } : { kind: "unknown" }
}

/** The two largest units of a duration: "133d 5h", "5h 12m", "12m 3s", "3s". */
export function formatDurationShort(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const units: Array<[string, number]> = [
    ["d", Math.floor(seconds / DAY_SECONDS)],
    ["h", Math.floor((seconds % DAY_SECONDS) / 3600)],
    ["m", Math.floor((seconds % 3600) / 60)],
    ["s", seconds % 60],
  ]
  const first = units.findIndex(([, value]) => value > 0)
  if (first === -1) return "0s"
  return units.slice(first, first + 2)
    .filter(([, value]) => value > 0)
    .map(([unit, value]) => `${value}${unit}`)
    .join(" ")
}

/** Parses a filter input: empty or invalid input turns the filter off. */
export function parseFilterNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const value = Number(trimmed.replace(",", "."))
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** Raw filter inputs, kept as text so partial input ("0.") stays editable. */
export interface SpaceFilterInputs {
  search: string
  ratioBelow: string
  seedingLongerThanDays: string
  inactiveForDays: string
  notSeeded: boolean
}

export const EMPTY_FILTER_INPUTS: SpaceFilterInputs = {
  search: "",
  ratioBelow: "",
  seedingLongerThanDays: "",
  inactiveForDays: "",
  notSeeded: false,
}

export function parseFilterInputs(inputs: SpaceFilterInputs): SpaceFilters {
  return {
    search: inputs.search,
    ratioBelow: parseFilterNumber(inputs.ratioBelow),
    seedingLongerThanDays: parseFilterNumber(inputs.seedingLongerThanDays),
    inactiveForDays: parseFilterNumber(inputs.inactiveForDays),
    notSeeded: inputs.notSeeded,
  }
}

export type QuickFilter = "all" | "lowRatio" | "inactive" | "notSeeded"

export const QUICK_FILTERS: readonly QuickFilter[] = ["all", "lowRatio", "inactive", "notSeeded"]

const QUICK_FILTER_PRESETS: Record<QuickFilter, Partial<SpaceFilterInputs>> = {
  all: {},
  lowRatio: { ratioBelow: String(LOW_RATIO) },
  inactive: { inactiveForDays: String(INACTIVE_DAYS) },
  notSeeded: { notSeeded: true },
}

/** Replaces the stat filters with a preset; the search text stays. */
export function applyQuickFilter(inputs: SpaceFilterInputs, quick: QuickFilter): SpaceFilterInputs {
  return { ...EMPTY_FILTER_INPUTS, search: inputs.search, ...QUICK_FILTER_PRESETS[quick] }
}

/** The preset the stat filters match exactly, or null for a custom combination. */
export function activeQuickFilter(inputs: SpaceFilterInputs): QuickFilter | null {
  return QUICK_FILTERS.find(quick => {
    const preset = applyQuickFilter(inputs, quick)
    return preset.ratioBelow.trim() === inputs.ratioBelow.trim() &&
      preset.seedingLongerThanDays.trim() === inputs.seedingLongerThanDays.trim() &&
      preset.inactiveForDays.trim() === inputs.inactiveForDays.trim() &&
      preset.notSeeded === inputs.notSeeded
  }) ?? null
}
