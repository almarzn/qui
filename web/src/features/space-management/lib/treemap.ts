/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

// Squarified treemap layout (Bruls, Huizing, van Wijk 2000). Each block's area is
// proportional to its value, and rows are filled while that keeps the blocks closer to squares.

export interface TreemapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TreemapBlock<T> extends TreemapRect {
  item: T
  value: number
}

/** Largest aspect ratio in a row of areas laid along a side of the given length. */
function worstRatio(sum: number, min: number, max: number, side: number): number {
  const sideSq = side * side
  const sumSq = sum * sum
  return Math.max((sideSq * max) / sumSq, sumSq / (sideSq * min))
}

/**
 * Lays out the items inside the bounds. Items with a value of zero or less are left out;
 * the rest are placed largest first.
 */
export function squarify<T>(
  items: ReadonlyArray<{ value: number; item: T }>,
  bounds: TreemapRect
): TreemapBlock<T>[] {
  const sorted = items
    .filter(entry => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, entry) => sum + entry.value, 0)
  if (total <= 0 || bounds.width <= 0 || bounds.height <= 0) return []

  const scale = (bounds.width * bounds.height) / total
  const areas = sorted.map(entry => entry.value * scale)
  const blocks: TreemapBlock<T>[] = []
  let rect = { ...bounds }
  let start = 0

  while (start < sorted.length) {
    const side = Math.min(rect.width, rect.height)
    let end = start + 1
    let sum = areas[start]
    let min = areas[start]
    let max = areas[start]
    let worst = worstRatio(sum, min, max, side)

    // Grow the row while adding the next block does not make the worst aspect ratio worse.
    while (end < sorted.length) {
      const area = areas[end]
      const next = worstRatio(sum + area, Math.min(min, area), Math.max(max, area), side)
      if (next > worst) break
      sum += area
      min = Math.min(min, area)
      max = Math.max(max, area)
      worst = next
      end++
    }

    if (rect.width >= rect.height) {
      // Column along the left edge.
      const columnWidth = sum / rect.height
      let y = rect.y
      for (let i = start; i < end; i++) {
        const height = areas[i] / columnWidth
        blocks.push({ x: rect.x, y, width: columnWidth, height, item: sorted[i].item, value: sorted[i].value })
        y += height
      }
      rect = { x: rect.x + columnWidth, y: rect.y, width: rect.width - columnWidth, height: rect.height }
    } else {
      // Row along the top edge.
      const rowHeight = sum / rect.width
      let x = rect.x
      for (let i = start; i < end; i++) {
        const width = areas[i] / rowHeight
        blocks.push({ x, y: rect.y, width, height: rowHeight, item: sorted[i].item, value: sorted[i].value })
        x += width
      }
      rect = { x: rect.x, y: rect.y + rowHeight, width: rect.width, height: rect.height - rowHeight }
    }

    start = end
  }

  return blocks
}
