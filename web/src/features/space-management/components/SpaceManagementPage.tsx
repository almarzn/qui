/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { useDateTimeFormatters } from "@/hooks/useDateTimeFormatters"
import { formatBytes } from "@/lib/utils"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useDeferredValue, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  EMPTY_FILTER_INPUTS,
  filterTree,
  flattenTree,
  hasActiveFilters,
  nodesCheckState,
  parseFilterInputs,
  partitionNodes,
  sortTree,
  toggleNodes,
  visibleSelection,
  type SpaceFilterInputs,
  type SpaceSection,
  type SpaceSort
} from "../lib/space-tree"
import { useRefreshSpaceTree, useSpaceTree } from "../queries"
import type { SpaceNode } from "../types"
import { SpaceDeleteDialog } from "./SpaceDeleteDialog"
import { SpaceFiltersBar } from "./SpaceFiltersBar"
import { SpaceOverviewBar } from "./SpaceOverviewBar"
import { SpaceTreeView } from "./SpaceTreeView"

const EMPTY_NODES: SpaceNode[] = []

function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function SpaceManagementPage() {
  const { t } = useTranslation("spaceManagement")
  const { formatISOTimestamp } = useDateTimeFormatters()
  const tree = useSpaceTree()
  const refresh = useRefreshSpaceTree()

  const [filterInputs, setFilterInputs] = useState<SpaceFilterInputs>(EMPTY_FILTER_INPUTS)
  const [sort, setSort] = useState<SpaceSort>({ key: "size", direction: "desc" })
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<SpaceSection>>(() => new Set())
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [deleteNodes, setDeleteNodes] = useState<SpaceNode[] | null>(null)
  // Filters compare against page-load time; a long-open page drifts by minutes at most.
  const [nowMs] = useState(() => Date.now())

  const deferredInputs = useDeferredValue(filterInputs)
  const filters = useMemo(() => parseFilterInputs(deferredInputs), [deferredInputs])

  const allNodes = tree.data?.nodes ?? EMPTY_NODES
  const visibleRoots = useMemo(
    () => sortTree(filterTree(allNodes, filters, nowMs), sort),
    [allNodes, filters, nowMs, sort]
  )
  const sections = useMemo(() => partitionNodes(visibleRoots), [visibleRoots])
  const rows = useMemo(() => flattenTree(sections, expanded, collapsedSections), [sections, expanded, collapsedSections])
  const openRoots = useMemo(
    () => (["library", "orphans"] as const).flatMap(section => collapsedSections.has(section) ? [] : sections[section]),
    [sections, collapsedSections]
  )
  const selection = useMemo(() => visibleSelection(visibleRoots, selected), [visibleRoots, selected])
  const selectionSize = useMemo(() => selection.reduce((sum, node) => sum + node.sizeBytes, 0), [selection])

  const handleToggleSelect = useCallback((node: SpaceNode) => {
    setSelected(prev => toggleNodes(prev, [node]))
  }, [])
  const handleToggleExpand = useCallback((id: string) => {
    setExpanded(prev => toggleInSet(prev, id))
  }, [])
  const handleToggleSection = useCallback((section: SpaceSection) => {
    setCollapsedSections(prev => toggleInSet(prev, section))
  }, [])
  const handleToggleAll = useCallback(() => {
    setSelected(prev => toggleNodes(prev, openRoots))
  }, [openRoots])

  const handleRefresh = () => {
    refresh.mutate(undefined, {
      onError: (error) => toast.error(t("actions.refreshError", { error: error.message })),
    })
  }

  const renderTree = () => {
    if (tree.isPending) {
      return (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }
    if (tree.error) {
      return <p className="text-sm text-destructive">{t("status.loadError", { error: tree.error.message })}</p>
    }
    if (allNodes.length === 0) {
      return <p className="py-8 text-center text-sm text-muted-foreground">{t("status.empty")}</p>
    }
    if (rows.length === 0 && hasActiveFilters(filters)) {
      return <p className="py-8 text-center text-sm text-muted-foreground">{t("status.noMatches")}</p>
    }
    return (
      <SpaceTreeView
        rows={rows}
        selected={selected}
        allCheckState={nodesCheckState(openRoots, selected)}
        onToggleAll={handleToggleAll}
        onToggleSelect={handleToggleSelect}
        onToggleExpand={handleToggleExpand}
        onToggleSection={handleToggleSection}
      />
    )
  }

  return (
    <div className="space-y-4 p-4 pb-16 lg:p-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refresh.isPending || tree.isPending}>
            <RefreshCw className={refresh.isPending ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            {t("actions.refresh")}
          </Button>
        }
      />

      <SpaceOverviewBar />

      <SpaceFiltersBar inputs={filterInputs} onInputsChange={setFilterInputs} sort={sort} onSortChange={setSort} />

      <div className="flex min-h-8 flex-wrap items-center gap-3 text-sm">
        {selection.length > 0 && (
          <>
            <span>{t("selection.summary", { count: selection.length, size: formatBytes(selectionSize) })}</span>
            <Button variant="destructive" size="sm" onClick={() => setDeleteNodes(selection)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("actions.delete")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t("actions.clearSelection")}
            </Button>
          </>
        )}
        {tree.data?.generatedAt && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t("status.generatedAt", { time: formatISOTimestamp(tree.data.generatedAt) })}
          </span>
        )}
      </div>

      {renderTree()}

      {deleteNodes && (
        <SpaceDeleteDialog
          nodes={deleteNodes}
          onClose={() => setDeleteNodes(null)}
          onDeleted={() => setSelected(new Set())}
        />
      )}
    </div>
  )
}
