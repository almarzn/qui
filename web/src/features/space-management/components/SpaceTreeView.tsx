/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { useDateTimeFormatters } from "@/hooks/useDateTimeFormatters"
import { formatRelativeTime } from "@/lib/dateTimeUtils"
import { cn, formatBytes, formatDuration, getRatioColor } from "@/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronRight } from "lucide-react"
import { memo, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"

import { nodeCheckState, type SpaceCheckState, type SpaceRow, type SpaceSection } from "../lib/space-tree"
import type { SpaceNode, SpaceNodeKind } from "../types"
import { ReclaimableValue } from "./ReclaimableValue"
import { SpaceNodeDetails } from "./SpaceNodeDetails"

// checkbox+title | instance | quality | added | size | reclaimable | up | down | ratio | seed time | last activity
const GRID_COLUMNS = "minmax(280px,1fr) 130px 120px 100px 90px 110px 90px 90px 60px 100px 110px"
// Column widths (1280px) + 10 gaps (80px) + row padding (24px)
const MIN_WIDTH = "min-w-[1384px]"
const ROW_HEIGHT = 40

const SECTION_KEYS: Record<SpaceSection, string> = {
  library: "sections.library",
  orphans: "sections.orphans",
}

const ORPHAN_KIND_KEYS: Partial<Record<SpaceNodeKind, string>> = {
  orphanTorrent: "kinds.orphanTorrent",
  orphanFile: "kinds.orphanFile",
}

interface SpaceTreeViewProps {
  rows: SpaceRow[]
  selected: ReadonlySet<string>
  allCheckState: SpaceCheckState
  onToggleAll: () => void
  onToggleSelect: (node: SpaceNode) => void
  onToggleExpand: (id: string) => void
  onToggleSection: (section: SpaceSection) => void
}

function HeaderRow({ allCheckState, onToggleAll }: Pick<SpaceTreeViewProps, "allCheckState" | "onToggleAll">) {
  const { t } = useTranslation("spaceManagement")
  return (
    <div
      className="sticky top-0 z-10 grid items-center gap-2 whitespace-nowrap border-b bg-card px-3 py-2 text-xs font-medium text-muted-foreground"
      style={{ gridTemplateColumns: GRID_COLUMNS }}
    >
      <div className="flex items-center gap-2 pl-6">
        <Checkbox checked={allCheckState} onCheckedChange={onToggleAll} aria-label={t("selection.selectAll")} />
        {t("columns.title")}
      </div>
      <div>{t("columns.instance")}</div>
      <div>{t("columns.quality")}</div>
      <div>{t("columns.added")}</div>
      <div className="text-right">{t("columns.size")}</div>
      <div className="text-right">{t("columns.reclaimable")}</div>
      <div className="text-right">{t("columns.uploaded")}</div>
      <div className="text-right">{t("columns.downloaded")}</div>
      <div className="text-right">{t("columns.ratio")}</div>
      <div className="text-right">{t("columns.seedingTime")}</div>
      <div>{t("columns.lastActivity")}</div>
    </div>
  )
}

interface NodeRowProps {
  node: SpaceNode
  depth: number
  hasChildren: boolean
  expanded: boolean
  checkState: SpaceCheckState
  onToggleSelect: (node: SpaceNode) => void
  onToggleExpand: (id: string) => void
}

const NodeRow = memo(function NodeRow({ node, depth, hasChildren, expanded, checkState, onToggleSelect, onToggleExpand }: NodeRowProps) {
  const { t } = useTranslation("spaceManagement")
  const { formatDateOnly } = useDateTimeFormatters()
  const addedSeconds = node.addedAt ? Date.parse(node.addedAt) / 1000 : Number.NaN
  const orphanKindKey = ORPHAN_KIND_KEYS[node.kind]
  const expandLabel = hasChildren
    ? (expanded ? t("details.collapse") : t("details.expand"))
    : (expanded ? t("details.hideDetails") : t("details.showDetails"))

  return (
    <>
      <div
        className="grid items-center gap-2 whitespace-nowrap px-3 text-sm hover:bg-muted/40"
        style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT }}
      >
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={expandLabel}
            aria-expanded={expanded}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
          </button>
          <Checkbox
            checked={checkState}
            onCheckedChange={() => onToggleSelect(node)}
            aria-label={t("selection.selectRow", { title: node.title })}
          />
          <span className="truncate" title={node.title}>
            {node.title}
            {node.year ? <span className="text-muted-foreground"> ({node.year})</span> : null}
          </span>
          {orphanKindKey && <Badge variant="outline">{t(orphanKindKey)}</Badge>}
        </div>
        <div className="truncate text-muted-foreground" title={node.arrInstanceName}>{node.arrInstanceName ?? ""}</div>
        <div className="truncate text-muted-foreground" title={node.quality}>{node.quality ?? ""}</div>
        <div className="text-muted-foreground">{Number.isNaN(addedSeconds) ? "" : formatDateOnly(addedSeconds)}</div>
        <div className="text-right tabular-nums">{formatBytes(node.sizeBytes)}</div>
        <div className="text-right tabular-nums">
          <ReclaimableValue bytes={node.reclaimableBytes} known={node.reclaimableKnown} />
        </div>
        <div className="text-right tabular-nums">{formatBytes(node.stats.uploaded)}</div>
        <div className="text-right tabular-nums">{formatBytes(node.stats.downloaded)}</div>
        <div className="text-right tabular-nums" style={{ color: getRatioColor(node.stats.ratio) }}>
          {node.stats.ratio.toFixed(2)}
        </div>
        <div className="text-right tabular-nums">{formatDuration(node.stats.seedingTimeSeconds)}</div>
        <div className="truncate text-muted-foreground">{node.stats.lastActivity ? formatRelativeTime(node.stats.lastActivity) : ""}</div>
      </div>
      {expanded && !hasChildren && <SpaceNodeDetails node={node} />}
    </>
  )
})

function SectionRow({ row, onToggleSection }: { row: Extract<SpaceRow, { type: "section" }>; onToggleSection: (section: SpaceSection) => void }) {
  const { t } = useTranslation("spaceManagement")
  return (
    <button
      type="button"
      onClick={() => onToggleSection(row.section)}
      aria-expanded={!row.collapsed}
      className="flex w-full items-center gap-2 border-y bg-muted/50 px-3 text-left text-sm font-semibold"
      style={{ minHeight: ROW_HEIGHT }}
    >
      <ChevronRight className={cn("h-4 w-4 transition-transform", !row.collapsed && "rotate-90")} />
      {t(SECTION_KEYS[row.section])}
      <span className="font-normal text-muted-foreground">
        {t("sections.summary", { count: row.count, size: formatBytes(row.sizeBytes) })}
      </span>
    </button>
  )
}

/** Virtualized tree: rows are measured, so an expanded detail panel grows its row. */
export function SpaceTreeView({ rows, selected, allCheckState, onToggleAll, onToggleSelect, onToggleExpand, onToggleSection }: SpaceTreeViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
  })

  return (
    <div ref={scrollRef} className="h-[65vh] min-h-[320px] overflow-auto rounded-md border bg-card">
      <div className={MIN_WIDTH}>
        <HeaderRow allCheckState={allCheckState} onToggleAll={onToggleAll} />
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(item => {
            const row = rows[item.index]
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full border-b border-border/50"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.type === "section" ? (
                  <SectionRow row={row} onToggleSection={onToggleSection} />
                ) : (
                  <NodeRow
                    node={row.node}
                    depth={row.depth}
                    hasChildren={row.hasChildren}
                    expanded={row.expanded}
                    checkState={nodeCheckState(row.node, selected)}
                    onToggleSelect={onToggleSelect}
                    onToggleExpand={onToggleExpand}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
