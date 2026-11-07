/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useDateTimeFormatters } from "@/hooks/useDateTimeFormatters"
import { formatRelativeTime } from "@/lib/dateTimeUtils"
import { getStateLabel } from "@/lib/torrent-state-utils"
import { formatBytes } from "@/lib/utils"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { SEEDING_STATE_KEYS } from "../lib/colors"
import { fileName } from "../lib/paths"
import { formatDurationShort, seedingState } from "../lib/space-tree"
import type { SpaceFile, SpaceNode, SpaceTorrent } from "../types"
import { ReclaimableValue } from "./ReclaimableValue"
import { SeedingDot } from "./SeedingBadge"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm tabular-nums">{children}</div>
    </div>
  )
}

function PathList({ paths }: { paths: string[] }) {
  const { t } = useTranslation("spaceManagement")
  if (paths.length === 0) return <p className="text-xs text-muted-foreground">{t("details.none")}</p>
  return (
    <ul className="space-y-0.5">
      {paths.map(path => <li key={path} className="break-all font-mono text-xs">{path}</li>)}
    </ul>
  )
}

function FileItem({ file }: { file: SpaceFile }) {
  const { t } = useTranslation("spaceManagement")
  const path = file.libraryPath ?? file.downloadPath ?? ""
  const linkCount = file.linkCount ?? null
  return (
    <li className="flex items-center gap-2 py-1 text-xs">
      <span className="min-w-0 flex-1 truncate font-mono" title={[file.libraryPath, file.downloadPath].filter(Boolean).join("\n")}>
        {fileName(path)}
      </span>
      <span className="tabular-nums text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
      <span className="w-16 text-right text-muted-foreground">
        {linkCount === null ? t("details.linksUnknown") : t("details.links", { links: linkCount })}
      </span>
      {file.hardlinked
        ? <Badge variant="secondary">{t("details.hardlinked")}</Badge>
        : <Badge variant="outline">{t("details.singleCopy")}</Badge>}
    </li>
  )
}

function TorrentItem({ torrent }: { torrent: SpaceTorrent }) {
  const { t } = useTranslation("spaceManagement")
  const { t: tTorrents } = useTranslation("torrents")
  return (
    <li className="space-y-1 rounded-md border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={torrent.isCrossSeed ? "outline" : "default"}>
          {torrent.isCrossSeed ? t("details.crossSeed") : t("details.main")}
        </Badge>
        <span className="font-medium">{torrent.tracker}</span>
        <span className="text-muted-foreground">{torrent.instanceName}</span>
        <span className="ml-auto text-muted-foreground">{getStateLabel(torrent.state, tTorrents)}</span>
      </div>
      <div className="break-all">{torrent.name}</div>
      <div className="flex flex-wrap gap-x-3 text-muted-foreground tabular-nums">
        <span>{t("seeding.ratio", { ratio: torrent.ratio.toFixed(2) })}</span>
        <span>{t("seeding.transfer", { up: formatBytes(torrent.uploaded), down: formatBytes(torrent.downloaded) })}</span>
        <span>{t("seeding.seedTime", { time: formatDurationShort(torrent.seedingTimeSeconds) })}</span>
      </div>
    </li>
  )
}

interface SpaceDetailsSheetProps {
  node: SpaceNode | null
  nowMs: number
  onClose: () => void
}

/** Everything about one item: stats, paths, files with hardlink info, and torrents. */
export function SpaceDetailsSheet({ node, nowMs, onClose }: SpaceDetailsSheetProps) {
  const { t } = useTranslation("spaceManagement")
  const { formatISOTimestamp } = useDateTimeFormatters()

  return (
    <Sheet open={node !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {node && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">
                {node.title}
                {node.year ? <span className="font-normal text-muted-foreground"> {node.year}</span> : null}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <SeedingDot state={seedingState(node, nowMs)} />
                  {t(SEEDING_STATE_KEYS[seedingState(node, nowMs)])}
                </span>
                {node.arrInstanceName && <Badge variant="outline">{node.arrInstanceName}</Badge>}
                {node.quality && <Badge variant="outline">{node.quality}</Badge>}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label={t("details.size")}>{formatBytes(node.sizeBytes)}</Stat>
                <Stat label={t("details.reclaimable")}>
                  <ReclaimableValue bytes={node.reclaimableBytes} known={node.reclaimableKnown} />
                </Stat>
                <Stat label={t("details.ratio")}>{node.torrents.length > 0 ? node.stats.ratio.toFixed(2) : t("details.none")}</Stat>
                <Stat label={t("details.uploaded")}>{formatBytes(node.stats.uploaded)}</Stat>
                <Stat label={t("details.downloaded")}>{formatBytes(node.stats.downloaded)}</Stat>
                <Stat label={t("details.seedTime")}>{formatDurationShort(node.stats.seedingTimeSeconds)}</Stat>
                <Stat label={t("details.lastActivity")}>
                  {node.stats.lastActivity ? formatRelativeTime(node.stats.lastActivity) : t("details.none")}
                </Stat>
                <Stat label={t("details.added")}>{node.addedAt ? formatISOTimestamp(node.addedAt) : t("details.none")}</Stat>
              </div>

              <Section title={t("details.libraryPaths")}><PathList paths={node.libraryPaths} /></Section>
              <Section title={t("details.downloadPaths")}><PathList paths={node.downloadPaths} /></Section>

              {node.files.length > 0 && (
                <Section title={t("details.files")}>
                  <ul className="divide-y">
                    {node.files.map((file, index) => (
                      <FileItem key={`${file.libraryPath ?? ""}|${file.downloadPath ?? ""}|${index}`} file={file} />
                    ))}
                  </ul>
                </Section>
              )}

              <Section title={t("details.torrents")}>
                {node.torrents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("seeding.states.notSeeded")}</p>
                ) : (
                  <ul className="space-y-2">
                    {node.torrents.map(torrent => (
                      <TorrentItem key={`${torrent.instanceId}:${torrent.hash}`} torrent={torrent} />
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
