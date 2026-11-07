/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import type { DiskSegmentKey } from "./disk"
import type { SeedingState } from "./space-tree"

// i18n-namespace: spaceManagement

// Theme tokens only, so every theme and both color schemes restyle the page.

export const SEEDING_COLORS: Record<SeedingState, string> = {
  healthy: "var(--ratio-good)",
  lowRatio: "var(--ratio-almost)",
  inactive: "var(--muted-foreground)",
  notSeeded: "var(--ratio-bad)",
}

export const DISK_SEGMENT_COLORS: Record<DiskSegmentKey, string> = {
  seeded: "var(--primary)",
  notSeeded: "var(--ratio-bad)",
  orphanTorrents: "var(--ratio-almost)",
  otherUsed: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
  free: "var(--muted)",
}

/** Tints a token for a block background while keeping the foreground text readable. */
export function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${percent}%, var(--card))`
}

export const SEEDING_STATE_KEYS: Record<SeedingState, string> = {
  healthy: "seeding.states.healthy",
  lowRatio: "seeding.states.lowRatio",
  inactive: "seeding.states.inactive",
  notSeeded: "seeding.states.notSeeded",
}
