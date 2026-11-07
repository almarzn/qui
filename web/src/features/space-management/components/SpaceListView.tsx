/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn, formatBytes } from "@/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronRight } from "lucide-react"
import { memo, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"

import { SEEDING_COLORS, tint } from "../lib/colors"
import {
  type BarEdges,
  nodeCheckState,
  reclaimableDisplay,
  seedingState,
  sizeBar,
  type SpaceCheckState,
  type SpaceRow,
  type SpaceSection
} from "../lib/space-tree"
import type { SpaceNode } from "../types"
import { CrossSeedBadge, SeedingBadge } from "./SeedingBadge"

// title | bar | size | seeding | cross-seeds
const GRID_COLUMNS = "minmax(0,2fr) minmax(48px,3fr) 76px 92px 36px"
const ROW_HEIGHT = 40

const SECTION_KEYS: Record<SpaceSection, string> = {
  library: "sections.library",
  orphans: "sections.orphans",
}

export interface SpaceListViewProps {
  rows: SpaceRow[]
  maxBytes: number
  nowMs: number
  selected: ReadonlySet<string>
  allCheckState: SpaceCheckState
  onToggleAll: () => void
  onToggleSelect: (node: SpaceNode) => void
  onToggleExpand: (id: string) => void
  onToggleSection: (section: SpaceSection) => void
  onOpen: (node: SpaceNode) => void
}

interface SizeBarCellProps {
  node: SpaceNode
  maxBytes: number
  offsetBytes: number
  edges: BarEdges
  color: string
}

function SizeBarCell({ node, maxBytes, offsetBytes, edges, color }: SizeBarCellProps) {
  const { t } = useTranslation("spaceManagement")
  const bar = sizeBar(node, maxBytes, offsetBytes)
  const solidShare = bar.totalPct > 0 ? (bar.reclaimablePct / bar.totalPct) * 100 : 0
  const display = reclaimableDisplay(node.reclaimableBytes, node.reclaimableKnown)
  const reclaimable = display.kind === "known"
    ? formatBytes(display.bytes)
    : display.kind === "atLeast" ? t("reclaimable.atLeast", { size: formatBytes(display.bytes) }) : t("reclaimable.unknown")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative h-3 w-full overflow-hidden rounded-sm bg-muted/40">
          {/* Only outer ends are rounded, so the seasons of a series join into one bar. */}
          <div
            className={cn("absolute inset-y-0 overflow-hidden", edges.start && "rounded-l-sm", edges.end && "rounded-r-sm")}
            style={{
              left: `${bar.offsetPct}%`,
              width: `${bar.totalPct}%`,
              // Kept by other links: hatched and light.
              background: `repeating-linear-gradient(135deg, ${tint(color, 45)} 0 3px, ${tint(color, 15)} 3px 6px)`,
            }}
          >
            {/* Freed by a delete: solid. */}
            <div className="h-full" style={{ width: `${solidShare}%`, background: color }} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{t("list.barTooltip", { reclaimable, size: formatBytes(node.sizeBytes) })}</TooltipContent>
    </Tooltip>
  )
}

interface NodeRowProps {
  node: SpaceNode
  depth: number
  offsetBytes: number
  edges: BarEdges
  hasChildren: boolean
  expanded: boolean
  checkState: SpaceCheckState
  maxBytes: number
  nowMs: number
  onToggleSelect: (node: SpaceNode) => void
  onToggleExpand: (id: string) => void
  onOpen: (node: SpaceNode) => void
}

const NodeRow = memo(function NodeRow({ node, depth, offsetBytes, edges, hasChildren, expanded, checkState, maxBytes, nowMs, onToggleSelect, onToggleExpand, onOpen }: NodeRowProps) {
  const { t } = useTranslation("spaceManagement")
  const state = seedingState(node, nowMs)

  return (
    <div
      className={cn(
        "grid cursor-pointer items-center gap-3 px-3 text-sm hover:bg-muted/40",
        checkState === true && "bg-primary/5"
      )}
      style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT }}
      onClick={() => onOpen(node)}
    >
      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpand(node.id)
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={expanded ? t("list.collapse") : t("list.expand")}
            aria-expanded={expanded}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Checkbox
          checked={checkState}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleSelect(node)}
          aria-label={t("selection.selectRow", { title: node.title })}
        />
        <button type="button" className="min-w-0 truncate text-left" title={node.title}>
          {node.title}
          {node.year ? <span className="text-muted-foreground"> {node.year}</span> : null}
        </button>
      </div>
      <SizeBarCell node={node} maxBytes={maxBytes} offsetBytes={offsetBytes} edges={edges} color={SEEDING_COLORS[state]} />
      <div className="text-right text-xs tabular-nums">{formatBytes(node.sizeBytes)}</div>
      <div><SeedingBadge node={node} state={state} /></div>
      <div><CrossSeedBadge node={node} /></div>
    </div>
  )
})

function SectionRow({ row, onToggleSection }: { row: Extract<SpaceRow, { type: "section" }>; onToggleSection: (section: SpaceSection) => void }) {
  const { t } = useTranslation("spaceManagement")
  return (
    <button
      type="button"
      onClick={() => onToggleSection(row.section)}
      aria-expanded={!row.collapsed}
      className="flex w-full items-center gap-2 bg-muted/50 px-3 text-left text-sm font-semibold"
      style={{ minHeight: ROW_HEIGHT - 8 }}
    >
      <ChevronRight className={cn("h-4 w-4 transition-transform", !row.collapsed && "rotate-90")} />
      {t(SECTION_KEYS[row.section])}
      <span className="font-normal text-muted-foreground">
        {t("sections.summary", { items: row.count, size: formatBytes(row.sizeBytes) })}
      </span>
    </button>
  )
}

/** Virtualized size-bar list; a series expands into its seasons. */
export function SpaceListView({ rows, maxBytes, nowMs, selected, allCheckState, onToggleAll, onToggleSelect, onToggleExpand, onToggleSection, onOpen }: SpaceListViewProps) {
  const { t } = useTranslation("spaceManagement")
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
  })

  return (
    <div ref={scrollRef} className="h-[65vh] min-h-[320px] overflow-y-auto rounded-md border bg-card">
      <div
        className="sticky top-0 z-10 grid items-center gap-3 whitespace-nowrap border-b bg-card px-3 py-2 text-xs font-medium text-muted-foreground"
        style={{ gridTemplateColumns: GRID_COLUMNS }}
      >
        <div className="flex items-center gap-2 pl-7">
          <Checkbox checked={allCheckState} onCheckedChange={onToggleAll} aria-label={t("selection.selectAll")} />
          {t("list.title")}
        </div>
        <div>{t("list.space")}</div>
        <div className="text-right">{t("list.size")}</div>
        <div>{t("list.seeding")}</div>
        <div />
      </div>
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
                  offsetBytes={row.offsetBytes}
                  edges={row.edges}
                  hasChildren={row.hasChildren}
                  expanded={row.expanded}
                  checkState={nodeCheckState(row.node, selected)}
                  maxBytes={maxBytes}
                  nowMs={nowMs}
                  onToggleSelect={onToggleSelect}
                  onToggleExpand={onToggleExpand}
                  onOpen={onOpen}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
