/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { describe, expect, it } from "vitest"

import { squarify, type TreemapRect } from "./treemap"

const bounds: TreemapRect = { x: 0, y: 0, width: 600, height: 400 }
const EPS = 1e-6

function overlaps(a: TreemapRect, b: TreemapRect): boolean {
  return a.x + EPS < b.x + b.width && b.x + EPS < a.x + a.width && a.y + EPS < b.y + b.height && b.y + EPS < a.y + a.height
}

describe("squarify", () => {
  // The worked example from Bruls et al.
  const values = [6, 6, 4, 3, 2, 2, 1]
  const blocks = squarify(values.map((value, index) => ({ value, item: index })), bounds)

  it("gives each block an area proportional to its value", () => {
    const total = values.reduce((sum, v) => sum + v, 0)
    for (const block of blocks) {
      expect(block.width * block.height).toBeCloseTo((block.value / total) * bounds.width * bounds.height, 6)
    }
  })

  it("keeps blocks inside the bounds without overlap", () => {
    for (const block of blocks) {
      expect(block.x).toBeGreaterThanOrEqual(-EPS)
      expect(block.y).toBeGreaterThanOrEqual(-EPS)
      expect(block.x + block.width).toBeLessThanOrEqual(bounds.width + EPS)
      expect(block.y + block.height).toBeLessThanOrEqual(bounds.height + EPS)
    }
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        expect(overlaps(blocks[i], blocks[j])).toBe(false)
      }
    }
  })

  it("places items largest first and keeps aspect ratios reasonable", () => {
    expect(blocks.map(block => block.value)).toEqual([6, 6, 4, 3, 2, 2, 1])
    for (const block of blocks) {
      expect(Math.max(block.width / block.height, block.height / block.width)).toBeLessThan(4)
    }
  })

  it("fills the whole area with one item", () => {
    expect(squarify([{ value: 5, item: "only" }], bounds)).toEqual([{ ...bounds, value: 5, item: "only" }])
  })

  it("drops non-positive values and returns nothing for empty input or bounds", () => {
    expect(squarify([{ value: 0, item: "a" }, { value: -1, item: "b" }, { value: 2, item: "c" }], bounds).map(b => b.item)).toEqual(["c"])
    expect(squarify([], bounds)).toEqual([])
    expect(squarify([{ value: 1, item: "a" }], { x: 0, y: 0, width: 0, height: 100 })).toEqual([])
  })

  it("offsets blocks by the bounds origin", () => {
    const [block] = squarify([{ value: 1, item: "a" }], { x: 10, y: 20, width: 30, height: 40 })
    expect(block).toMatchObject({ x: 10, y: 20, width: 30, height: 40 })
  })
})
