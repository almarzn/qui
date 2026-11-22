/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Checkbox } from "@/components/ui/checkbox"
import { cn, formatBytes } from "@/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronRight } from "lucide-react"
import { memo, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"

import { SEEDING_COLORS } from "../lib/colors"
import {
  nodeCheckState,
  reclaimableDisplay,
  reclaimablePct,
  seedingState,
  type SpaceCheckState,
  type SpaceRow
} from "../lib/space-tree"
import type { SpaceNode } from "../types"
import { SeedingCell } from "./SeedingBadge"

const GRID = "grid grid-cols-[minmax(0,1fr)_104px] gap-x-3 md:grid-cols-[minmax(0,1fr)_minmax(0,200px)_84px_132px]"
const ROW_HEIGHT = 48

export interface SpaceListViewProps {
  rows: SpaceRow[]
  maxReclaimableBytes: number
  nowMs: number
  selected: ReadonlySet<string>
  allCheckState: SpaceCheckState
  onToggleAll: () => void
  onToggleSelect: (node: SpaceNode) => void
  onToggleExpand: (id: string) => void
  onOpen: (node: SpaceNode) => void
}

function FreesCell({ node, maxReclaimableBytes, color }: { node: SpaceNode; maxReclaimableBytes: number; color: string }) {
  const { t } = useTranslation("spaceManagement")
  const display = reclaimableDisplay(node.reclaimableBytes, node.reclaimableKnown)
  let text: string
  if (display.kind === "unknown") text = t("reclaimable.unknown")
  else if (display.kind === "atLeast") text = t("reclaimable.atLeast", { size: formatBytes(display.bytes) })
  else if (display.bytes === 0) text = t("list.keptBySeeding")
  else text = formatBytes(display.bytes)
  const muted = display.kind !== "known" || display.bytes === 0

  return (
    <div className="flex flex-col items-end gap-1">
      <span className={cn("whitespace-nowrap text-right tabular-nums", muted ? "text-xs text-muted-foreground" : "font-medium")}>{text}</span>
      <span className="h-[3px] w-[72px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${reclaimablePct(node, maxReclaimableBytes)}%`, background: color }} />
      </span>
    </div>
  )
}

interface NodeRowProps {
  node: SpaceNode
  depth: number
  hasChildren: boolean
  expanded: boolean
  checkState: SpaceCheckState
  maxReclaimableBytes: number
  nowMs: number
  onToggleSelect: (node: SpaceNode) => void
  onToggleExpand: (id: string) => void
  onOpen: (node: SpaceNode) => void
}

const NodeRow = memo(function NodeRow({ node, depth, hasChildren, expanded, checkState, maxReclaimableBytes, nowMs, onToggleSelect, onToggleExpand, onOpen }: NodeRowProps) {
  const { t } = useTranslation("spaceManagement")
  const state = seedingState(node, nowMs)
  const indent = depth * 22

  return (
    <div
      className={cn(
        GRID,
        "cursor-pointer items-center gap-y-0.5 px-3 py-1.5 text-sm hover:bg-muted/40 md:px-4",
        checkState === true && "bg-primary/5"
      )}
      style={{ minHeight: depth > 0 ? ROW_HEIGHT - 8 : ROW_HEIGHT }}
      onClick={() => onOpen(node)}
    >
      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indent }}>
        <Checkbox
          checked={checkState}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleSelect(node)}
          aria-label={t("selection.selectRow", { title: node.title })}
        />
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
            <ChevronRight className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button type="button" className={cn("min-w-0 truncate text-left", depth > 0 && "text-muted-foreground")} title={node.title}>
          {node.title}
          {node.year ? <span className="ml-1.5 text-muted-foreground">{node.year}</span> : null}
        </button>
      </div>
      <div
        className="col-start-1 row-start-2 min-w-0 pl-[calc(var(--indent)+3.25rem)] md:col-start-auto md:row-start-auto md:pl-0"
        style={{ ["--indent" as string]: `${indent}px` }}
      >
        <SeedingCell node={node} state={state} nowMs={nowMs} />
      </div>
      <div className="hidden text-right text-xs tabular-nums text-muted-foreground md:block">{formatBytes(node.sizeBytes)}</div>
      <div className="col-start-2 row-span-2 row-start-1 md:col-start-auto md:row-span-1 md:row-start-auto">
        <FreesCell node={node} maxReclaimableBytes={maxReclaimableBytes} color={SEEDING_COLORS[state]} />
      </div>
    </div>
  )
})

export function SpaceListView({ rows, maxReclaimableBytes, nowMs, selected, allCheckState, onToggleAll, onToggleSelect, onToggleExpand, onOpen }: SpaceListViewProps) {
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
    <div ref={scrollRef} className="h-[65vh] min-h-[320px] overflow-y-auto rounded-lg border bg-card">
      <div className={cn(GRID, "sticky top-0 z-10 items-center whitespace-nowrap border-b bg-card px-3 py-2.5 text-xs text-muted-foreground md:px-4")}>
        <div className="flex items-center gap-2">
          <Checkbox checked={allCheckState} onCheckedChange={onToggleAll} aria-label={t("selection.selectAll")} />
          <span className="pl-7">{t("list.title")}</span>
        </div>
        <div className="hidden md:block">{t("list.seeding")}</div>
        <div className="hidden text-right md:block">{t("list.size")}</div>
        <div className="text-right">{t("list.frees")}</div>
      </div>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index]
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full border-b border-border/60"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <NodeRow
                node={row.node}
                depth={row.depth}
                hasChildren={row.hasChildren}
                expanded={row.expanded}
                checkState={nodeCheckState(row.node, selected)}
                maxReclaimableBytes={maxReclaimableBytes}
                nowMs={nowMs}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
                onOpen={onOpen}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
