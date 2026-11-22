/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Page } from "@/components/layout/Page"
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
  flattenNodes,
  hasActiveFilters,
  nodesCheckState,
  parseFilterInputs,
  partitionNodes,
  quickFilterCounts,
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
import { SpaceDetailsSheet } from "./SpaceDetailsSheet"
import { SpaceDiskBar } from "./SpaceDiskBar"
import { SpaceFiltersBar, type SpaceView } from "./SpaceFiltersBar"
import { SpaceListView } from "./SpaceListView"
import { SpaceTreemapView } from "./SpaceTreemapView"

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

  const [view, setView] = useState<SpaceView>("list")
  const [filterInputs, setFilterInputs] = useState<SpaceFilterInputs>(EMPTY_FILTER_INPUTS)
  const [sort, setSort] = useState<SpaceSort>({ key: "reclaimable", direction: "desc" })
  const [section, setSection] = useState<SpaceSection>("library")
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [detailsNode, setDetailsNode] = useState<SpaceNode | null>(null)
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
  const allSections = useMemo(() => partitionNodes(allNodes), [allNodes])
  const tabRoots = sections[section]
  const rows = useMemo(() => flattenNodes(tabRoots, expanded), [tabRoots, expanded])
  const maxReclaimableBytes = useMemo(() => tabRoots.reduce((max, node) => Math.max(max, node.reclaimableBytes), 0), [tabRoots])
  const sectionCounts = useMemo(() => ({ library: sections.library.length, orphans: sections.orphans.length }), [sections])
  const quickCounts = useMemo(
    () => quickFilterCounts(allSections[section], deferredInputs, nowMs),
    [allSections, section, deferredInputs, nowMs]
  )
  const selection = useMemo(() => visibleSelection(tabRoots, selected), [tabRoots, selected])
  const seriesTitles = useMemo(
    () => new Map(allNodes.flatMap(node => (node.children ?? []).map(child => [child.id, node.title] as const))),
    [allNodes]
  )
  const openDelete = () => {
    setDeleteNodes(selection.map(node => {
      const series = seriesTitles.get(node.id)
      return series ? { ...node, title: t("deleteDialog.seasonTitle", { series, season: node.title }) } : node
    }))
  }
  const selectionFrees = useMemo(() => selection.reduce((sum, node) => sum + node.reclaimableBytes, 0), [selection])

  const handleToggleSelect = useCallback((node: SpaceNode) => {
    setSelected(prev => toggleNodes(prev, [node]))
  }, [])
  const handleToggleExpand = useCallback((id: string) => {
    setExpanded(prev => toggleInSet(prev, id))
  }, [])
  const handleToggleAll = useCallback(() => {
    setSelected(prev => toggleNodes(prev, tabRoots))
  }, [tabRoots])

  const handleRefresh = () => {
    refresh.mutate(undefined, {
      onError: (error) => toast.error(t("actions.refreshError", { error: error.message })),
    })
  }

  const renderItems = () => {
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
    if (tabRoots.length === 0 && hasActiveFilters(filters)) {
      return <p className="py-8 text-center text-sm text-muted-foreground">{t("status.noMatches")}</p>
    }
    if (view === "treemap") {
      return (
        <SpaceTreemapView
          roots={tabRoots}
          nowMs={nowMs}
          selected={selected}
          onToggleSelect={handleToggleSelect}
          onOpen={setDetailsNode}
        />
      )
    }
    return (
      <SpaceListView
        rows={rows}
        maxReclaimableBytes={maxReclaimableBytes}
        nowMs={nowMs}
        selected={selected}
        allCheckState={nodesCheckState(tabRoots, selected)}
        onToggleAll={handleToggleAll}
        onToggleSelect={handleToggleSelect}
        onToggleExpand={handleToggleExpand}
        onOpen={setDetailsNode}
      />
    )
  }

  return (
    <Page
      title={t("page.title")}
      description={t("page.description")}
      controls={
        <Button variant="outline" onClick={handleRefresh} disabled={refresh.isPending || tree.isPending}>
          <RefreshCw className={refresh.isPending ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
          {t("actions.refresh")}
        </Button>
      }
    >

      <SpaceDiskBar />

      <SpaceFiltersBar
        section={section}
        onSectionChange={setSection}
        sectionCounts={sectionCounts}
        quickCounts={quickCounts}
        inputs={filterInputs}
        onInputsChange={setFilterInputs}
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
      />

      {renderItems()}

      {tree.data?.generatedAt && (
        <p className="text-xs text-muted-foreground">
          {t("status.generatedAt", { time: formatISOTimestamp(tree.data.generatedAt) })}
        </p>
      )}

      {selection.length > 0 && (
        <div className="sticky bottom-4 z-30 flex justify-center">
          <div className="flex w-full max-w-xl items-center gap-3 rounded-xl bg-primary py-2 pl-4 pr-2 text-sm text-primary-foreground shadow-lg">
            <span className="min-w-0 flex-1 truncate tabular-nums">
              {t("selection.frees", { items: selection.length, size: formatBytes(selectionFrees) })}
            </span>
            <Button variant="ghost" size="sm" className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={() => setSelected(new Set())}>
              {t("actions.clearSelection")}
            </Button>
            <Button variant="destructive" size="sm" className="dark:bg-destructive" onClick={openDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("actions.delete")}
            </Button>
          </div>
        </div>
      )}

      <SpaceDetailsSheet node={detailsNode} nowMs={nowMs} onClose={() => setDetailsNode(null)} />

      {deleteNodes && (
        <SpaceDeleteDialog
          nodes={deleteNodes}
          onClose={() => setDeleteNodes(null)}
          onDeleted={() => setSelected(new Set())}
        />
      )}
    </Page>
  )
}
