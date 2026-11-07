/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { api } from "@/lib/api"
import { isDemo } from "@/lib/demo"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { spaceApi } from "./api"
import type { SpaceDeleteRequest } from "./types"

export const spaceQueryKeys = {
  all: ["space-management"] as const,
  overview: () => [...spaceQueryKeys.all, "overview"] as const,
  tree: () => [...spaceQueryKeys.all, "tree"] as const,
  deletePlan: (request: Omit<SpaceDeleteRequest, "dryRun">) => [...spaceQueryKeys.all, "delete-plan", request] as const,
}

export function useSpaceOverview() {
  return useQuery({
    queryKey: spaceQueryKeys.overview(),
    queryFn: spaceApi.getOverview,
    staleTime: 60_000,
  })
}

export function useSpaceTree() {
  return useQuery({
    queryKey: spaceQueryKeys.tree(),
    queryFn: () => spaceApi.getTree(false),
    // The server caches the tree for ~5 minutes; refetching sooner returns the same data.
    staleTime: 5 * 60_000,
  })
}

/** Rebuilds the server-side tree cache and stores the result. */
export function useRefreshSpaceTree() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => spaceApi.getTree(true),
    onSuccess: (tree) => {
      queryClient.setQueryData(spaceQueryKeys.tree(), tree)
      void queryClient.invalidateQueries({ queryKey: spaceQueryKeys.overview() })
    },
  })
}

/** Dry-run plan for the confirmation dialog. */
export function useSpaceDeletePlan(request: Omit<SpaceDeleteRequest, "dryRun">, enabled: boolean) {
  return useQuery({
    queryKey: spaceQueryKeys.deletePlan(request),
    queryFn: () => spaceApi.delete({ ...request, dryRun: true }),
    enabled: enabled && request.nodeIds.length > 0,
    staleTime: 0,
    gcTime: 0,
  })
}

export function useSpaceDelete() {
  const queryClient = useQueryClient()
  const refresh = useRefreshSpaceTree()
  return useMutation({
    mutationFn: (request: Omit<SpaceDeleteRequest, "dryRun">) => spaceApi.delete({ ...request, dryRun: false }),
    onSettled: () => {
      // Deleted items change both the tree and the disk numbers: rebuild the server cache.
      refresh.mutate()
      void queryClient.invalidateQueries({ queryKey: spaceQueryKeys.overview() })
    },
  })
}

/** The page is offered once at least one Sonarr/Radarr instance exists. */
export function useSpaceManagementAvailable(): boolean {
  const { data } = useQuery({
    // Shares the cache entry of the arr settings manager, so adding an instance shows the page.
    queryKey: ["arrInstances"],
    queryFn: () => api.listArrInstances(),
    staleTime: 5 * 60_000,
    // The demo has no arr backend and hides the nav anyway.
    enabled: !isDemo,
  })
  return (data?.length ?? 0) > 0
}
