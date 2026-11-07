/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatBytes } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

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
  const summary = t("disk.summary", {
    tracked: formatBytes(data.totals.trackedBytes),
    free: formatBytes(disk?.freeBytes ?? 0),
    reclaimable: formatBytes(data.totals.reclaimableBytes),
  })

  if (!disk) {
    return <p className="text-sm text-muted-foreground">{summary}</p>
  }

  return (
    <div className="space-y-2">
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={t("disk.ariaLabel", { used: formatBytes(disk.usedBytes), total: formatBytes(disk.totalBytes) })}
      >
        {DISK_SEGMENT_KEYS.map(key => {
          const bytes = disk.segments[key]
          if (bytes <= 0 || disk.totalBytes <= 0) return null
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {DISK_SEGMENT_KEYS.map(key => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-border/50" style={{ background: DISK_SEGMENT_COLORS[key] }} />
            {t(SEGMENT_LABEL_KEYS[key])}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span>{summary}</span>
        <span className="truncate font-mono text-xs text-muted-foreground" title={disk.paths.join("\n")}>
          {disk.paths.join(" · ")}
        </span>
      </div>
    </div>
  )
}
