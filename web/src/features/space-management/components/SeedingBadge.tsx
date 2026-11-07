/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelativeTime } from "@/lib/dateTimeUtils"
import { formatBytes } from "@/lib/utils"
import { GitBranch } from "lucide-react"
import { useTranslation } from "react-i18next"

import { SEEDING_COLORS, SEEDING_STATE_KEYS } from "../lib/colors"
import { crossSeedCount, formatDurationShort, type SeedingState } from "../lib/space-tree"
import type { SpaceNode } from "../types"

export function SeedingDot({ state }: { state: SeedingState }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: SEEDING_COLORS[state] }} />
}

/** A coloured dot with the ratio, or "not seeded"; the tooltip holds the transfer stats. */
export function SeedingBadge({ node, state }: { node: SpaceNode; state: SeedingState }) {
  const { t } = useTranslation("spaceManagement")
  const { stats } = node

  if (state === "notSeeded") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <SeedingDot state={state} />
        {t("seeding.states.notSeeded")}
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-1.5 text-xs tabular-nums">
          <SeedingDot state={state} />
          {stats.ratio.toFixed(2)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-0.5 text-xs">
        <div>{t(SEEDING_STATE_KEYS[state])}</div>
        <div>{t("seeding.transfer", { up: formatBytes(stats.uploaded), down: formatBytes(stats.downloaded) })}</div>
        <div>{t("seeding.seedTime", { time: formatDurationShort(stats.seedingTimeSeconds) })}</div>
        <div>
          {stats.lastActivity
            ? t("seeding.lastActivity", { time: formatRelativeTime(stats.lastActivity) })
            : t("seeding.noActivity")}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function CrossSeedBadge({ node }: { node: SpaceNode }) {
  const { t } = useTranslation("spaceManagement")
  const count = crossSeedCount(node)
  if (count === 0) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
          <GitBranch className="h-3.5 w-3.5" />
          {count}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("seeding.crossSeeds", { total: count })}</TooltipContent>
    </Tooltip>
  )
}
