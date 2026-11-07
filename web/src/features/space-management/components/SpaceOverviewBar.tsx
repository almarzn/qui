/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatBytes } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useSpaceOverview } from "../queries"
import type { SpaceMount, SpaceMountKind } from "../types"

const MOUNT_KIND_KEYS: Record<SpaceMountKind, string> = {
  download: "overview.mountKinds.download",
  library: "overview.mountKinds.library",
}

function MountCard({ mount }: { mount: SpaceMount }) {
  const { t } = useTranslation("spaceManagement")
  const percent = mount.totalBytes > 0 ? (mount.usedBytes / mount.totalBytes) * 100 : 0

  return (
    <Card className="gap-2 py-3">
      <CardContent className="space-y-2 px-4">
        <div className="flex items-center gap-2">
          <Badge variant={mount.kind === "download" ? "secondary" : "outline"}>{t(MOUNT_KIND_KEYS[mount.kind])}</Badge>
          <span className="truncate font-mono text-xs" title={mount.path}>{mount.path}</span>
        </div>
        <Progress value={percent} className="h-2" />
        <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
          <span>{t("overview.used", { used: formatBytes(mount.usedBytes) })}</span>
          <span>{t("overview.freeOf", { free: formatBytes(mount.freeBytes), total: formatBytes(mount.totalBytes) })}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{formatBytes(value)}</div>
    </div>
  )
}

/** Header bar: disk usage per download and library mount, plus feature-wide totals. */
export function SpaceOverviewBar() {
  const { t } = useTranslation("spaceManagement")
  const { data, isPending, error } = useSpaceOverview()

  if (isPending) {
    return (
      <div className="flex h-16 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-destructive">{t("overview.loadError", { error: error.message })}</p>
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={t("overview.tracked")} value={data.totals.trackedBytes} />
        <StatTile label={t("overview.reclaimable")} value={data.totals.reclaimableBytes} />
        <StatTile label={t("overview.orphanTorrents")} value={data.totals.orphanTorrentBytes} />
        <StatTile label={t("overview.orphanFiles")} value={data.totals.orphanFileBytes} />
      </div>
      {data.mounts.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.mounts.map(mount => <MountCard key={`${mount.kind}:${mount.path}`} mount={mount} />)}
        </div>
      )}
    </div>
  )
}
