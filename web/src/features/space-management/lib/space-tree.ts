/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import type { SpaceNode } from "../types"

// Pure tree logic for the Space Management page: filtering, sorting, flattening for the
// virtualized list, and leaf-based selection. Kept free of React so it is unit-testable.

const DAY_MS = 86_400_000

export type SpaceSortKey = "size" | "reclaimable"
export type SpaceSortDirection = "asc" | "desc"

export interface SpaceSort {
  key: SpaceSortKey
  direction: SpaceSortDirection
}

export interface SpaceFilters {
  search: string
  /** Keep nodes whose rolled-up ratio is below this value. */
  ratioBelow: number | null
  /** Keep nodes that have seeded for at least this many days. */
  seedingLongerThanDays: number | null
  /** Keep nodes without activity for at least this many days. */
  inactiveForDays: number | null
}

export const EMPTY_SPACE_FILTERS: SpaceFilters = {
  search: "",
  ratioBelow: null,
  seedingLongerThanDays: null,
  inactiveForDays: null,
}

export type SpaceSection = "library" | "orphans"

export function isOrphan(node: SpaceNode): boolean {
  return node.kind === "orphanTorrent" || node.kind === "orphanFile"
}

export function hasActiveFilters(filters: SpaceFilters): boolean {
  return filters.search.trim() !== "" ||
    filters.ratioBelow !== null ||
    filters.seedingLongerThanDays !== null ||
    filters.inactiveForDays !== null
}

/** Whole days since an RFC3339 timestamp, or null when it is missing or unparsable. */
export function daysSince(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (Number.isNaN(time) || time <= 0) return null
  return Math.max(0, Math.floor((nowMs - time) / DAY_MS))
}

function matchesSearch(node: SpaceNode, needle: string): boolean {
  if (needle === "") return true
  return node.title.toLowerCase().includes(needle)
}

function matchesStats(node: SpaceNode, filters: SpaceFilters, nowMs: number): boolean {
  const { stats } = node
  if (filters.ratioBelow !== null && !(stats.ratio < filters.ratioBelow)) return false
  if (filters.seedingLongerThanDays !== null && stats.seedingTimeSeconds < filters.seedingLongerThanDays * 86_400) {
    return false
  }
  if (filters.inactiveForDays !== null) {
    // No recorded activity at all counts as inactive: nothing has touched it.
    const idle = daysSince(stats.lastActivity, nowMs)
    if (idle !== null && idle < filters.inactiveForDays) return false
  }
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
  | { type: "node"; id: string; node: SpaceNode; depth: number; hasChildren: boolean; expanded: boolean }

/**
 * Flattens the visible tree into rows for the virtualizer. `expanded` holds node ids:
 * an expanded series shows its seasons, an expanded leaf shows its details.
 */
export function flattenTree(
  sections: Record<SpaceSection, SpaceNode[]>,
  expanded: ReadonlySet<string>,
  collapsedSections: ReadonlySet<SpaceSection>
): SpaceRow[] {
  const rows: SpaceRow[] = []

  const pushNode = (node: SpaceNode, depth: number) => {
    const hasChildren = (node.children?.length ?? 0) > 0
    const isExpanded = expanded.has(node.id)
    rows.push({ type: "node", id: node.id, node, depth, hasChildren, expanded: isExpanded })
    if (hasChildren && isExpanded) {
      for (const child of node.children ?? []) pushNode(child, depth + 1)
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
      for (const node of nodes) pushNode(node, 0)
    }
  }

  return rows
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
}

export const EMPTY_FILTER_INPUTS: SpaceFilterInputs = {
  search: "",
  ratioBelow: "",
  seedingLongerThanDays: "",
  inactiveForDays: "",
}

export function parseFilterInputs(inputs: SpaceFilterInputs): SpaceFilters {
  return {
    search: inputs.search,
    ratioBelow: parseFilterNumber(inputs.ratioBelow),
    seedingLongerThanDays: parseFilterNumber(inputs.seedingLongerThanDays),
    inactiveForDays: parseFilterNumber(inputs.inactiveForDays),
  }
}
