/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { HttpResponse, http } from "msw"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import "@/i18n"
import { server } from "@/test/msw/server"

import type { SpaceDeleteRequest, SpaceNode, SpaceTree } from "../types"
import { SpaceDeleteDialog } from "./SpaceDeleteDialog"

afterEach(cleanup)

// Invented titles and paths only.
const movie: SpaceNode = {
  id: "radarr:1:movie:7",
  kind: "movie",
  title: "Harbor of Glass",
  sizeBytes: 4 * 1024 ** 3,
  reclaimableBytes: 4 * 1024 ** 3,
  reclaimableKnown: true,
  libraryPaths: ["/media/movies/Harbor of Glass (2019)"],
  downloadPaths: ["/downloads/movies/Harbor.of.Glass.2019.1080p-GRP"],
  files: [],
  torrents: [],
  stats: { uploaded: 0, downloaded: 0, ratio: 0, seedingTimeSeconds: 0 },
}

const emptyTree: SpaceTree = { nodes: [], generatedAt: "2026-06-01T00:00:00Z" }

function renderDialog(onDeleted = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SpaceDeleteDialog nodes={[movie]} onClose={onClose} onDeleted={onDeleted} />
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { onDeleted, onClose }
}

describe("SpaceDeleteDialog", () => {
  it("plans with a dry run, then deletes with the same options and refreshes the tree", async () => {
    const requests: SpaceDeleteRequest[] = []
    const treeRefreshes: string[] = []
    server.use(
      http.post("*/api/space/delete", async ({ request }) => {
        const body = await request.json() as SpaceDeleteRequest
        requests.push(body)
        const status = body.dryRun ? "planned" : "ok"
        return HttpResponse.json({
          reclaimableBytes: 4 * 1024 ** 3,
          actions: [
            { nodeId: movie.id, type: "deleteTorrent", target: "qbit: Harbor.of.Glass.2019.1080p-GRP", status },
            { nodeId: movie.id, type: "deleteTorrent", target: "qbit: Harbor.of.Glass.2019.1080p.REPACK-GRP", status, isCrossSeed: true, tracker: "tracker.example" },
            { nodeId: movie.id, type: "deleteArrFile", target: "/media/movies/Harbor of Glass (2019)/movie.mkv", status },
          ],
        })
      }),
      http.get("*/api/space/tree", ({ request }) => {
        treeRefreshes.push(new URL(request.url).search)
        return HttpResponse.json(emptyTree)
      }),
      http.get("*/api/space/overview", () => HttpResponse.json({ mounts: [], totals: {}, generatedAt: "" }))
    )

    const { onDeleted } = renderDialog()

    await screen.findByText("Planned actions")
    expect(screen.getByRole("heading", { name: "Harbor of Glass" })).not.toBeNull()
    expect(screen.getByText("qbit: Harbor.of.Glass.2019.1080p-GRP")).not.toBeNull()
    expect(screen.getByText("Cross-seed")).not.toBeNull()
    expect(screen.getByText("tracker.example")).not.toBeNull()
    // Library files show the file name; the path sits in a tooltip.
    expect(screen.getByText("movie.mkv")).not.toBeNull()
    expect(screen.queryByText("/media/movies/Harbor of Glass (2019)/movie.mkv")).toBeNull()
    expect(requests).toEqual([{
      nodeIds: [movie.id],
      deleteTorrents: true,
      deleteCrossSeeds: true,
      deleteArrFiles: true,
      dryRun: true,
    }])

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await screen.findByText("Results")
    expect(requests[1]).toEqual({ ...requests[0], dryRun: false })
    expect(onDeleted).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(treeRefreshes).toContain("?refresh=true"))
  })

  it("re-plans without arr files when that option is turned off", async () => {
    const requests: SpaceDeleteRequest[] = []
    server.use(
      http.post("*/api/space/delete", async ({ request }) => {
        requests.push(await request.json() as SpaceDeleteRequest)
        return HttpResponse.json({ reclaimableBytes: 0, actions: [] })
      })
    )

    renderDialog()
    await screen.findByText("Nothing to delete with these options.")

    fireEvent.click(screen.getByRole("checkbox", { name: "Delete files in Sonarr/Radarr" }))

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ deleteTorrents: true, deleteCrossSeeds: true, deleteArrFiles: false, dryRun: true })
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("asks for an option and sends nothing when both are off", async () => {
    const requests: SpaceDeleteRequest[] = []
    server.use(
      http.post("*/api/space/delete", async ({ request }) => {
        requests.push(await request.json() as SpaceDeleteRequest)
        return HttpResponse.json({ reclaimableBytes: 0, actions: [] })
      })
    )

    renderDialog()
    await waitFor(() => expect(requests).toHaveLength(1))
    fireEvent.click(screen.getByRole("checkbox", { name: "Delete torrents + cross-seeds" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Delete files in Sonarr/Radarr" }))

    await screen.findByText("Choose at least one option.")
    expect(requests.some(request => !request.deleteTorrents && !request.deleteArrFiles)).toBe(false)
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
