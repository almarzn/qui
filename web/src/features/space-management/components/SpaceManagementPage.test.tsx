/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { HttpResponse, http } from "msw"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import "@/i18n"
import { formatBytes } from "@/lib/utils"
import { server } from "@/test/msw/server"

import type { SpaceNode, SpaceOverview, SpaceTree } from "../types"
import { ReclaimableValue } from "./ReclaimableValue"
import { SpaceManagementPage } from "./SpaceManagementPage"

// jsdom has no ResizeObserver; report a fixed size so the treemap lays out.
class FixedResizeObserver {
  private callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe() {
    this.callback([{ contentRect: { width: 600, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FixedResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const GiB = 1024 ** 3

// One filesystem reported by two mounts.
const overview: SpaceOverview = {
  mounts: [
    { path: "/downloads", kind: "download", totalBytes: 1000 * GiB, usedBytes: 600 * GiB, freeBytes: 400 * GiB },
    { path: "/media", kind: "library", totalBytes: 1000 * GiB, usedBytes: 600 * GiB, freeBytes: 400 * GiB },
  ],
  totals: { trackedBytes: 321 * GiB, reclaimableBytes: 123 * GiB, orphanTorrentBytes: 7 * GiB, orphanFileBytes: 3 * GiB },
  generatedAt: "2026-06-01T00:00:00Z",
}

function leaf(id: string, kind: SpaceNode["kind"], title: string, sizeBytes: number): SpaceNode {
  return {
    id,
    kind,
    title,
    sizeBytes,
    reclaimableBytes: sizeBytes,
    reclaimableKnown: true,
    libraryPaths: ["/media/" + title],
    downloadPaths: [],
    files: [],
    torrents: [],
    stats: { uploaded: 0, downloaded: 0, ratio: 0, seedingTimeSeconds: 0 },
  }
}

// Invented titles only.
const tree: SpaceTree = {
  generatedAt: "2026-06-01T00:00:00Z",
  nodes: [
    leaf("radarr:1:movie:7", "movie", "Harbor of Glass", 4 * GiB),
    {
      ...leaf("sonarr:1:series:3", "series", "The Copper Lantern", 6 * GiB),
      children: [
        leaf("sonarr:1:season:3:1", "season", "Season 1", 4 * GiB),
        leaf("sonarr:1:season:3:2", "season", "Season 2", 2 * GiB),
      ],
    },
  ],
}

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  )
}

function serve() {
  server.use(
    http.get("*/api/space/overview", () => HttpResponse.json(overview)),
    http.get("*/api/space/tree", () => HttpResponse.json(tree))
  )
}

describe("SpaceManagementPage", () => {
  it("shows one disk bar for mounts on the same filesystem", async () => {
    serve()
    renderWithClient(<SpaceManagementPage />)

    await screen.findByText(`${formatBytes(321 * GiB)} tracked · ${formatBytes(400 * GiB)} free · ${formatBytes(123 * GiB)} reclaimable`)
    expect(screen.getByText("/downloads · /media")).not.toBeNull()
    expect(screen.getAllByRole("img", { name: /^Disk usage/ })).toHaveLength(1)
    // jsdom renders no virtual rows; the select-all checkbox proves the list mounted.
    await screen.findByRole("checkbox", { name: "Select all visible items" })
  })

  it("zooms the treemap into a series and opens details for a season", async () => {
    serve()
    renderWithClient(<SpaceManagementPage />)

    fireEvent.click(await screen.findByRole("button", { name: "Treemap" }))
    expect(screen.getByRole("button", { name: "Harbor of Glass" })).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Show the seasons of The Copper Lantern" }))
    expect(screen.queryByRole("button", { name: "Harbor of Glass" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Season 1" }))

    await screen.findByRole("heading", { name: "Season 1" })
    expect(screen.getByText("/media/Season 1")).not.toBeNull()
  })

  it("selects a treemap block with shift-click and offers the delete", async () => {
    serve()
    renderWithClient(<SpaceManagementPage />)

    fireEvent.click(await screen.findByRole("button", { name: "Treemap" }))
    fireEvent.click(screen.getByRole("button", { name: "Harbor of Glass" }), { shiftKey: true })

    expect(screen.getByText(`Selected: 1 · ${formatBytes(4 * GiB)}`)).not.toBeNull()
    expect(screen.queryByRole("heading", { name: "Harbor of Glass" })).toBeNull()
  })

  it("shows the API error instead of the items", async () => {
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
