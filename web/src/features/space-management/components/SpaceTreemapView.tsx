/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Checkbox } from "@/components/ui/checkbox"
import { cn, formatBytes } from "@/lib/utils"
import { ChevronRight } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"

import { SEEDING_COLORS, SEEDING_STATE_KEYS, tint } from "../lib/colors"
import { nodeCheckState, seedingState, type SeedingState, type SpaceCheckState } from "../lib/space-tree"
import { squarify, type TreemapBlock } from "../lib/treemap"
import type { SpaceNode } from "../types"
import { SeedingDot } from "./SeedingBadge"

const LABEL_MIN_WIDTH = 72
const LABEL_MIN_HEIGHT = 34
const SIZE_MIN_HEIGHT = 50
const CHECKBOX_MIN = 30
const LEGEND: readonly SeedingState[] = ["healthy", "lowRatio", "inactive", "notSeeded"]

interface SpaceTreemapViewProps {
  roots: SpaceNode[]
  nowMs: number
  selected: ReadonlySet<string>
  onToggleSelect: (node: SpaceNode) => void
  onOpen: (node: SpaceNode) => void
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(prev => prev.width === width && prev.height === height ? prev : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

interface BlockProps {
  block: TreemapBlock<SpaceNode>
  state: SeedingState
  checkState: SpaceCheckState
  onActivate: (node: SpaceNode, select: boolean) => void
}

const Block = memo(function Block({ block, state, checkState, onActivate }: BlockProps) {
  const { t } = useTranslation("spaceManagement")
  const node = block.item
  const color = SEEDING_COLORS[state]
  const isSeries = (node.children?.length ?? 0) > 0
  const showLabel = block.width >= LABEL_MIN_WIDTH && block.height >= LABEL_MIN_HEIGHT
  const showSize = showLabel && block.height >= SIZE_MIN_HEIGHT
  const showCheckbox = block.width >= CHECKBOX_MIN && block.height >= CHECKBOX_MIN
  const selected = checkState !== false

  const handleClick = (event: MouseEvent) => {
    onActivate(node, event.shiftKey || event.ctrlKey || event.metaKey)
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") onActivate(node, event.shiftKey || event.ctrlKey || event.metaKey)
    if (event.key === " ") {
      event.preventDefault()
      onActivate(node, true)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title={t("treemap.blockTitle", { title: node.title, size: formatBytes(node.sizeBytes) })}
      aria-label={isSeries ? t("treemap.zoomInto", { title: node.title }) : node.title}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="absolute p-px"
      style={{ left: block.x, top: block.y, width: block.width, height: block.height }}
    >
      <div
        className={cn(
          "relative h-full w-full cursor-pointer overflow-hidden rounded-[3px] border transition-[filter] hover:brightness-110 focus-visible:outline-none",
          selected ? "ring-2 ring-inset ring-primary" : "border-transparent"
        )}
        style={{ background: tint(color, selected ? 75 : 45), borderColor: tint(color, 80) }}
      >
        {showCheckbox && (
          <Checkbox
            checked={checkState}
            className="absolute left-1.5 top-1.5 bg-card"
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={() => onActivate(node, true)}
            aria-label={t("selection.selectRow", { title: node.title })}
          />
        )}
        {showLabel && (
          <div className={cn("flex h-full flex-col p-1.5 text-xs leading-tight", showCheckbox && "pl-7")}>
            <span className="truncate font-medium">
              {node.title}
              {isSeries && <ChevronRight className="ml-0.5 inline h-3 w-3 align-[-2px]" />}
            </span>
            {showSize && <span className="truncate text-muted-foreground tabular-nums">{formatBytes(node.sizeBytes)}</span>}
          </div>
        )}
      </div>
    </div>
  )
})

/**
 * Treemap of the visible items: area is size, colour is seeding state. A click on a series
 * zooms into its seasons; a click on anything else opens its details. Shift, Ctrl or Cmd with
 * a click, or the checkbox, selects the block for deletion.
 */
export function SpaceTreemapView({ roots, nowMs, selected, onToggleSelect, onOpen }: SpaceTreemapViewProps) {
  const { t } = useTranslation("spaceManagement")
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const [zoomId, setZoomId] = useState<string | null>(null)

  // A zoomed series that a filter or refresh removed falls back to the full view.
  const zoomed = zoomId ? roots.find(node => node.id === zoomId && (node.children?.length ?? 0) > 0) ?? null : null
  const items = useMemo(() => zoomed ? zoomed.children ?? [] : roots, [zoomed, roots])

  const blocks = useMemo(
    () => squarify(items.map(node => ({ value: node.sizeBytes, item: node })), { x: 0, y: 0, width: size.width, height: size.height })
      // Blocks under a few square pixels cannot be seen or clicked.
      .filter(block => block.width * block.height >= 4),
    [items, size.width, size.height]
  )

  const handleActivate = useCallback((node: SpaceNode, select: boolean) => {
    if (select) onToggleSelect(node)
    else if (!zoomed && (node.children?.length ?? 0) > 0) setZoomId(node.id)
    else onOpen(node)
  }, [zoomed, onToggleSelect, onOpen])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <nav className="flex min-w-0 items-center gap-1" aria-label={t("treemap.breadcrumb")}>
          <button
            type="button"
            className={cn("hover:underline", zoomed ? "text-primary" : "font-medium")}
            onClick={() => setZoomId(null)}
            disabled={!zoomed}
          >
            {t("treemap.all")}
          </button>
          {zoomed && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="truncate font-medium">{zoomed.title}</span>
              <button type="button" className="ml-2 text-xs text-primary hover:underline" onClick={() => onOpen(zoomed)}>
                {t("treemap.seriesDetails")}
              </button>
            </>
          )}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {LEGEND.map(state => (
            <span key={state} className="inline-flex items-center gap-1.5">
              <SeedingDot state={state} />
              {t(SEEDING_STATE_KEYS[state])}
            </span>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="relative h-[65vh] min-h-[320px] overflow-hidden rounded-md border bg-card">
        {blocks.map(block => (
          <Block
            key={block.item.id}
            block={block}
            state={seedingState(block.item, nowMs)}
            checkState={nodeCheckState(block.item, selected)}
            onActivate={handleActivate}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("treemap.hint")}</p>
    </div>
  )
}
