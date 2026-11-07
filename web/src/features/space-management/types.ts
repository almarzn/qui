/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

// Mirrors the /api/space/* contract. Keep in sync with internal/web/swagger/openapi.yaml.

export type SpaceMountKind = "download" | "library"

export interface SpaceMount {
  path: string
  kind: SpaceMountKind
  totalBytes: number
  usedBytes: number
  freeBytes: number
}

export interface SpaceTotals {
  trackedBytes: number
  reclaimableBytes: number
  orphanTorrentBytes: number
  orphanFileBytes: number
}

export interface SpaceOverview {
  mounts: SpaceMount[]
  totals: SpaceTotals
  generatedAt: string
}

export type SpaceNodeKind = "series" | "season" | "movie" | "orphanTorrent" | "orphanFile"

export type SpaceArrType = "sonarr" | "radarr"

export interface SpaceStats {
  uploaded: number
  downloaded: number
  ratio: number
  /** Max over the node's torrents. */
  seedingTimeSeconds: number
  /** RFC3339, max over the node's torrents. */
  lastActivity: string
}

export interface SpaceFile {
  libraryPath?: string
  downloadPath?: string
  sizeBytes: number
  linkCount?: number | null
  hardlinked: boolean
}

export interface SpaceTorrent {
  instanceId: number
  instanceName: string
  hash: string
  name: string
  /** Hostname only. */
  tracker: string
  savePath: string
  contentPath: string
  sizeBytes: number
  uploaded: number
  downloaded: number
  ratio: number
  seedingTimeSeconds: number
  lastActivity: string
  addedOn: string
  state: string
  isCrossSeed: boolean
  crossSeedOf?: string
}

export interface SpaceNode {
  id: string
  kind: SpaceNodeKind
  title: string
  year?: number
  arrInstanceId?: number
  arrInstanceName?: string
  arrType?: SpaceArrType
  quality?: string
  /** RFC3339 import date. */
  addedAt?: string
  sizeBytes: number
  reclaimableBytes: number
  reclaimableKnown: boolean
  libraryPaths: string[]
  downloadPaths: string[]
  /** Leaf-level detail; empty on series. */
  files: SpaceFile[]
  torrents: SpaceTorrent[]
  stats: SpaceStats
  /** series -> seasons */
  children?: SpaceNode[]
}

export interface SpaceTree {
  nodes: SpaceNode[]
  generatedAt: string
}

export interface SpaceDeleteRequest {
  nodeIds: string[]
  deleteTorrents: boolean
  deleteCrossSeeds: boolean
  deleteArrFiles: boolean
  dryRun: boolean
}

export type SpaceDeleteActionType = "deleteTorrent" | "deleteArrFile"

export type SpaceDeleteActionStatus = "planned" | "ok" | "error"

export interface SpaceDeleteAction {
  nodeId: string
  type: SpaceDeleteActionType
  target: string
  status: SpaceDeleteActionStatus
  error?: string
}

export interface SpaceDeleteResponse {
  reclaimableBytes: number
  actions: SpaceDeleteAction[]
}
