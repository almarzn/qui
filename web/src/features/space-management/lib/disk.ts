/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import type { SpaceMount, SpaceOverview } from "../types"

export interface SpaceFilesystem {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  paths: string[]
}

/**
 * Mounts that report the same total and free bytes sit on the same filesystem
 * (a download and a library folder on one disk); each filesystem is listed once.
 */
export function uniqueFilesystems(mounts: SpaceMount[]): SpaceFilesystem[] {
  const byKey = new Map<string, SpaceFilesystem>()
  for (const mount of mounts) {
    const key = `${mount.totalBytes}:${mount.freeBytes}`
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.paths.includes(mount.path)) existing.paths.push(mount.path)
      continue
    }
    byKey.set(key, { totalBytes: mount.totalBytes, usedBytes: mount.usedBytes, freeBytes: mount.freeBytes, paths: [mount.path] })
  }
  return [...byKey.values()]
}

export type DiskSegmentKey = "seeded" | "notSeeded" | "orphanTorrents" | "otherUsed" | "free"

export const DISK_SEGMENT_KEYS: readonly DiskSegmentKey[] = ["seeded", "notSeeded", "orphanTorrents", "otherUsed", "free"]

export interface DiskBreakdown {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  paths: string[]
  segments: Record<DiskSegmentKey, number>
}

/**
 * One bar for all download and library storage: seeded arr items, library files no torrent
 * seeds, orphan torrents, other used space, and free space. The feature totals are scaled down
 * when they exceed the used space, so the bar never overflows.
 */
export function diskBreakdown(overview: SpaceOverview): DiskBreakdown | null {
  const filesystems = uniqueFilesystems(overview.mounts)
  if (filesystems.length === 0) return null

  const totalBytes = filesystems.reduce((sum, fs) => sum + fs.totalBytes, 0)
  const usedBytes = filesystems.reduce((sum, fs) => sum + fs.usedBytes, 0)
  const freeBytes = filesystems.reduce((sum, fs) => sum + fs.freeBytes, 0)

  const { trackedBytes, orphanTorrentBytes, orphanFileBytes } = overview.totals
  const notSeeded = Math.max(0, orphanFileBytes)
  const orphanTorrents = Math.max(0, orphanTorrentBytes)
  const seeded = Math.max(0, trackedBytes - orphanTorrents - notSeeded)
  const known = seeded + notSeeded + orphanTorrents
  const scale = known > usedBytes && known > 0 ? usedBytes / known : 1

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    paths: filesystems.flatMap(fs => fs.paths),
    segments: {
      seeded: seeded * scale,
      notSeeded: notSeeded * scale,
      orphanTorrents: orphanTorrents * scale,
      otherUsed: Math.max(0, usedBytes - known * scale),
      free: freeBytes,
    },
  }
}
