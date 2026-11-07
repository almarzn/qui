/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { describe, expect, it } from "vitest"

import type { SpaceDeleteAction, SpaceMount, SpaceNode, SpaceOverview } from "../types"
import { groupDeleteActions } from "./delete-plan"
import { diskBreakdown, uniqueFilesystems } from "./disk"
import { fileName } from "./paths"

const disk = (path: string, kind: SpaceMount["kind"], total = 1000, free = 400): SpaceMount =>
  ({ path, kind, totalBytes: total, usedBytes: total - free, freeBytes: free })

const overview = (mounts: SpaceMount[], tracked: number, orphanTorrents: number, orphanFiles: number): SpaceOverview => ({
  mounts,
  totals: { trackedBytes: tracked, reclaimableBytes: 0, orphanTorrentBytes: orphanTorrents, orphanFileBytes: orphanFiles },
  generatedAt: "",
})

describe("uniqueFilesystems", () => {
  it("merges mounts that report the same total and free bytes", () => {
    const filesystems = uniqueFilesystems([disk("/data/downloads", "download"), disk("/data/media", "library"), disk("/data/tv", "library")])
    expect(filesystems).toEqual([{ totalBytes: 1000, usedBytes: 600, freeBytes: 400, paths: ["/data/downloads", "/data/media", "/data/tv"] }])
  })

  it("keeps different disks apart", () => {
    expect(uniqueFilesystems([disk("/a", "download"), disk("/b", "library", 2000, 100)])).toHaveLength(2)
  })
})

describe("diskBreakdown", () => {
  it("splits the used space into seeded, not seeded, orphan torrents and other", () => {
    const result = diskBreakdown(overview([disk("/a", "download"), disk("/b", "library")], 400, 50, 100))
    expect(result).toMatchObject({ totalBytes: 1000, usedBytes: 600, freeBytes: 400 })
    expect(result?.segments).toEqual({ seeded: 250, notSeeded: 100, orphanTorrents: 50, otherUsed: 200, free: 400 })
  })

  it("adds up separate disks", () => {
    const result = diskBreakdown(overview([disk("/a", "download"), disk("/b", "library", 2000, 1000)], 0, 0, 0))
    expect(result).toMatchObject({ totalBytes: 3000, usedBytes: 1600, freeBytes: 1400 })
  })

  it("scales the feature totals down when they exceed the used space", () => {
    const result = diskBreakdown(overview([disk("/a", "download")], 1200, 0, 0))
    expect(result?.segments.seeded).toBe(600)
    expect(result?.segments.otherUsed).toBe(0)
  })

  it("returns null without mounts", () => {
    expect(diskBreakdown(overview([], 1, 0, 0))).toBeNull()
  })
})

describe("groupDeleteActions", () => {
  const node = (id: string, title: string) => ({ id, title }) as SpaceNode
  const action = (nodeId: string, type: SpaceDeleteAction["type"], target: string): SpaceDeleteAction =>
    ({ nodeId, type, target, status: "planned" })

  it("groups actions per item in selection order and splits torrents from files", () => {
    const groups = groupDeleteActions(
      [action("b", "deleteArrFile", "/media/b.mkv"), action("a", "deleteTorrent", "qbit: A"), action("b", "deleteTorrent", "qbit: B")],
      [node("a", "Alpha"), node("b", "Bravo"), node("c", "Charlie")]
    )
    expect(groups.map(g => [g.title, g.torrents.length, g.files.length])).toEqual([["Alpha", 1, 0], ["Bravo", 1, 1]])
  })
})

describe("fileName", () => {
  it("returns the last segment of slash and backslash paths", () => {
    expect(fileName("/media/movies/Harbor of Glass (2019)/movie.mkv")).toBe("movie.mkv")
    expect(fileName("D:\\media\\show\\episode.mkv")).toBe("episode.mkv")
    expect(fileName("/media/folder/")).toBe("folder")
    expect(fileName("plain.mkv")).toBe("plain.mkv")
  })
})
