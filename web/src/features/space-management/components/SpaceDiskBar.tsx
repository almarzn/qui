/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatBytes } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"

import { DISK_SEGMENT_COLORS } from "../lib/colors"
import { DISK_SEGMENT_KEYS, diskBreakdown, type DiskSegmentKey } from "../lib/disk"
import { useSpaceOverview } from "../queries"

const SEGMENT_LABEL_KEYS: Record<DiskSegmentKey, string> = {
  seeded: "disk.segments.seeded",
  notSeeded: "disk.segments.notSeeded",
  orphanTorrents: "disk.segments.orphanTorrents",
  otherUsed: "disk.segments.otherUsed",
  free: "disk.segments.free",
}

/** Header: one bar for the download and library storage, split by what uses it. */
export function SpaceDiskBar() {
  const { t } = useTranslation("spaceManagement")
  const { data, isPending, error } = useSpaceOverview()

  if (isPending) {
    return (
      <div className="flex h-14 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (error) {
    return <p className="text-sm text-destructive">{t("disk.loadError", { error: error.message })}</p>
  }

  const disk = diskBreakdown(data)
  const headline = (
    <div className="text-4xl font-semibold leading-none tracking-tight tabular-nums">
      <Trans
        t={t}
        i18nKey="disk.headline"
        values={{ size: formatBytes(data.totals.reclaimableBytes) }}
        components={{ muted: <span className="ml-1.5 text-base font-medium tracking-normal text-muted-foreground" /> }}
      />
    </div>
  )

  if (!disk) return headline

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        {headline}
        <span className="min-w-0 text-sm text-muted-foreground tabular-nums" title={disk.paths.join(", ")}>
          <Trans
            t={t}
            i18nKey="disk.usage"
            values={{ used: formatBytes(disk.usedBytes), total: formatBytes(disk.totalBytes), free: formatBytes(disk.freeBytes) }}
            components={{ strong: <span className="font-medium text-foreground" /> }}
          />
        </span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={t("disk.ariaLabel", { used: formatBytes(disk.usedBytes), total: formatBytes(disk.totalBytes) })}
      >
        {DISK_SEGMENT_KEYS.map(key => {
          const bytes = disk.segments[key]
          if (bytes <= 0 || disk.totalBytes <= 0 || key === "free") return null
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <div
                  className="h-full"
                  style={{ width: `${(bytes / disk.totalBytes) * 100}%`, background: DISK_SEGMENT_COLORS[key] }}
                />
              </TooltipTrigger>
              <TooltipContent>{t("disk.segmentTooltip", { label: t(SEGMENT_LABEL_KEYS[key]), size: formatBytes(bytes) })}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground tabular-nums">
        {DISK_SEGMENT_KEYS.map(key => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px] border border-border/50" style={{ background: DISK_SEGMENT_COLORS[key] }} />
            {t(SEGMENT_LABEL_KEYS[key])}
            <span className="font-medium text-foreground">{formatBytes(disk.segments[key])}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
