/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelativeTime } from "@/lib/dateTimeUtils"
import { formatBytes } from "@/lib/utils"
import { useTranslation } from "react-i18next"

import { SEEDING_COLORS, SEEDING_STATE_KEYS } from "../lib/colors"
import { crossSeedCount, formatDurationShort, type SeedingState } from "../lib/space-tree"
import type { SpaceNode } from "../types"

export function SeedingDot({ state }: { state: SeedingState }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: SEEDING_COLORS[state] }} />
}

function SeedingNote({ node, state, nowMs }: { node: SpaceNode; state: SeedingState; nowMs: number }) {
  const { t } = useTranslation("spaceManagement")
  const { stats } = node
  const crossSeeds = crossSeedCount(node)
  const idleSeconds = stats.lastActivity ? Math.max(0, (nowMs - Date.parse(stats.lastActivity)) / 1000) : null
  const main = state === "inactive" && idleSeconds !== null
    ? t("list.idleFor", { time: formatDurationShort(idleSeconds) })
    : t("seeding.ratio", { ratio: stats.ratio.toFixed(2) })
  return (
    <span className="min-w-0 truncate text-muted-foreground">
      {main}
      {crossSeeds > 0 && <span className="ml-2">{t("seeding.crossSeeds", { total: crossSeeds })}</span>}
    </span>
  )
}

export function SeedingCell({ node, state, nowMs }: { node: SpaceNode; state: SeedingState; nowMs: number }) {
  const { t } = useTranslation("spaceManagement")
  const { stats } = node
  const label = (
    <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[13px]">
      <SeedingDot state={state} />
      <span className="shrink-0">{t(SEEDING_STATE_KEYS[state])}</span>
      {state !== "notSeeded" && <SeedingNote node={node} state={state} nowMs={nowMs} />}
    </span>
  )
  if (state === "notSeeded") return label

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent className="space-y-0.5 text-xs">
        <div>{t("seeding.ratio", { ratio: stats.ratio.toFixed(2) })}</div>
        <div>{t("seeding.transfer", { up: formatBytes(stats.uploaded), down: formatBytes(stats.downloaded) })}</div>
        <div>{t("seeding.seedTime", { time: formatDurationShort(stats.seedingTimeSeconds) })}</div>
        <div>
          {stats.lastActivity
            ? t("seeding.lastActivity", { time: formatRelativeTime(stats.lastActivity) })
            : t("seeding.noActivity")}
        </div>
        {crossSeedCount(node) > 0 && <div>{t("seeding.crossSeeds", { total: crossSeedCount(node) })}</div>}
      </TooltipContent>
    </Tooltip>
  )
}
