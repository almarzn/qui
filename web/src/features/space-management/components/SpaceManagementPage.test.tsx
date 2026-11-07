/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { HttpResponse, http } from "msw"
import { afterEach, describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import "@/i18n"
import { formatBytes } from "@/lib/utils"
import { server } from "@/test/msw/server"

import type { SpaceOverview, SpaceTree } from "../types"
import { ReclaimableValue } from "./ReclaimableValue"
import { SpaceManagementPage } from "./SpaceManagementPage"

afterEach(cleanup)

const GiB = 1024 ** 3

const overview: SpaceOverview = {
  mounts: [
    { path: "/downloads", kind: "download", totalBytes: 1000 * GiB, usedBytes: 600 * GiB, freeBytes: 400 * GiB },
    { path: "/media", kind: "library", totalBytes: 2000 * GiB, usedBytes: 500 * GiB, freeBytes: 1500 * GiB },
  ],
  totals: { trackedBytes: 321 * GiB, reclaimableBytes: 123 * GiB, orphanTorrentBytes: 7 * GiB, orphanFileBytes: 3 * GiB },
  generatedAt: "2026-06-01T00:00:00Z",
}

const tree: SpaceTree = {
  generatedAt: "2026-06-01T00:00:00Z",
  nodes: [{
    id: "radarr:1:movie:7",
    kind: "movie",
    title: "Harbor of Glass",
    sizeBytes: 4 * GiB,
    reclaimableBytes: 4 * GiB,
    reclaimableKnown: true,
    libraryPaths: [],
    downloadPaths: [],
    files: [],
    torrents: [],
    stats: { uploaded: 0, downloaded: 0, ratio: 0, seedingTimeSeconds: 0, lastActivity: "" },
  }],
}

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  )
}

describe("SpaceManagementPage", () => {
  it("renders the disk overview and the tree header from the API", async () => {
    server.use(
      http.get("*/api/space/overview", () => HttpResponse.json(overview)),
      http.get("*/api/space/tree", () => HttpResponse.json(tree))
    )

    renderWithClient(<SpaceManagementPage />)

    await screen.findByText(formatBytes(123 * GiB))
    expect(screen.getByText(formatBytes(321 * GiB))).not.toBeNull()
    expect(screen.getByText("/downloads")).not.toBeNull()
    expect(screen.getByText("/media")).not.toBeNull()
    expect(screen.getByText(`${formatBytes(1500 * GiB)} free of ${formatBytes(2000 * GiB)}`)).not.toBeNull()
    // jsdom renders no virtual rows; the header and select-all checkbox prove the tree mounted.
    await screen.findByRole("checkbox", { name: "Select all visible items" })
  })

  it("shows the API error instead of the tree", async () => {
    server.use(
      http.get("*/api/space/overview", () => HttpResponse.json(overview)),
      http.get("*/api/space/tree", () => HttpResponse.json({ error: "arr unreachable" }, { status: 502 }))
    )

    renderWithClient(<SpaceManagementPage />)

    await screen.findByText("Could not load the space tree: arr unreachable")
  })
})

describe("ReclaimableValue", () => {
  it("formats known, lower-bound and unknown values", () => {
    renderWithClient(
      <>
        <ReclaimableValue bytes={2 * GiB} known />
        <ReclaimableValue bytes={GiB} known={false} />
        <ReclaimableValue bytes={0} known={false} />
      </>
    )

    expect(screen.getByText(formatBytes(2 * GiB))).not.toBeNull()
    expect(screen.getByText(`≥ ${formatBytes(GiB)}`)).not.toBeNull()
    expect(screen.getByText("Unknown")).not.toBeNull()
  })
})
