/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Badge } from "@/components/ui/badge"
import { getStateLabel } from "@/lib/torrent-state-utils"
import { formatBytes, formatDuration } from "@/lib/utils"
import { useTranslation } from "react-i18next"

import type { SpaceFile, SpaceNode, SpaceTorrent } from "../types"

function PathList({ label, paths }: { label: string; paths: string[] }) {
  const { t } = useTranslation("spaceManagement")
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {paths.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("details.none")}</div>
      ) : (
        <ul className="space-y-0.5">
          {paths.map(path => <li key={path} className="break-all font-mono text-xs">{path}</li>)}
        </ul>
      )}
    </div>
  )
}

function FileRow({ file }: { file: SpaceFile }) {
  const { t } = useTranslation("spaceManagement")
  const linkCount = file.linkCount ?? null
  return (
    <tr className="border-t align-top">
      <td className="py-1 pr-3">
        {file.libraryPath && <div className="break-all font-mono">{file.libraryPath}</div>}
        {file.downloadPath && file.downloadPath !== file.libraryPath && (
          <div className="break-all font-mono text-muted-foreground">{file.downloadPath}</div>
        )}
      </td>
      <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{formatBytes(file.sizeBytes)}</td>
      <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
        {linkCount === null ? t("details.linksUnknown") : linkCount}
      </td>
      <td className="whitespace-nowrap py-1">
        {file.hardlinked ? <Badge variant="secondary">{t("details.hardlinked")}</Badge> : t("details.singleCopy")}
      </td>
    </tr>
  )
}

function TorrentRow({ torrent }: { torrent: SpaceTorrent }) {
  const { t } = useTranslation("spaceManagement")
  const { t: tTorrents } = useTranslation("torrents")
  return (
    <tr className="border-t align-top">
      <td className="py-1 pr-3">
        <Badge variant={torrent.isCrossSeed ? "outline" : "default"}>
          {torrent.isCrossSeed ? t("details.crossSeed") : t("details.main")}
        </Badge>
      </td>
      <td className="py-1 pr-3">
        <div className="break-all">{torrent.name}</div>
        <div className="break-all font-mono text-muted-foreground">{torrent.contentPath || torrent.savePath}</div>
      </td>
      <td className="whitespace-nowrap py-1 pr-3">{torrent.instanceName}</td>
      <td className="whitespace-nowrap py-1 pr-3">{torrent.tracker}</td>
      <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{formatBytes(torrent.uploaded)}</td>
      <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{formatBytes(torrent.downloaded)}</td>
      <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{torrent.ratio.toFixed(2)}</td>
      <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{formatDuration(torrent.seedingTimeSeconds)}</td>
      <td className="whitespace-nowrap py-1">{getStateLabel(torrent.state, tTorrents)}</td>
    </tr>
  )
}

/** Expanded leaf detail: paths, per-file hardlink info, and the torrents behind the item. */
export function SpaceNodeDetails({ node }: { node: SpaceNode }) {
  const { t } = useTranslation("spaceManagement")

  return (
    <div className="space-y-3 border-t bg-muted/30 px-4 py-3 text-xs">
      <div className="grid gap-3 md:grid-cols-2">
        <PathList label={t("details.libraryPaths")} paths={node.libraryPaths} />
        <PathList label={t("details.downloadPaths")} paths={node.downloadPaths} />
      </div>

      {node.files.length > 0 && (
        <div className="space-y-1">
          <div className="font-medium text-muted-foreground">{t("details.files")}</div>
          <table className="w-full">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="pb-1 pr-3 font-normal">{t("details.path")}</th>
                <th className="pb-1 pr-3 font-normal">{t("columns.size")}</th>
                <th className="pb-1 pr-3 font-normal">{t("details.links")}</th>
                <th className="pb-1 font-normal">{t("details.hardlinked")}</th>
              </tr>
            </thead>
            <tbody>
              {node.files.map((file, index) => (
                <FileRow key={`${file.libraryPath ?? ""}|${file.downloadPath ?? ""}|${index}`} file={file} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1">
        <div className="font-medium text-muted-foreground">{t("details.torrents")}</div>
        {node.torrents.length === 0 ? (
          <div className="text-muted-foreground">{t("details.none")}</div>
        ) : (
          <table className="w-full">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="pb-1 pr-3 font-normal" />
                <th className="pb-1 pr-3 font-normal">{t("details.name")}</th>
                <th className="pb-1 pr-3 font-normal">{t("details.qbitInstance")}</th>
                <th className="pb-1 pr-3 font-normal">{t("details.tracker")}</th>
                <th className="pb-1 pr-3 font-normal">{t("columns.uploaded")}</th>
                <th className="pb-1 pr-3 font-normal">{t("columns.downloaded")}</th>
                <th className="pb-1 pr-3 font-normal">{t("columns.ratio")}</th>
                <th className="pb-1 pr-3 font-normal">{t("columns.seedingTime")}</th>
                <th className="pb-1 font-normal">{t("details.state")}</th>
              </tr>
            </thead>
            <tbody>
              {node.torrents.map(torrent => (
                <TorrentRow key={`${torrent.instanceId}:${torrent.hash}`} torrent={torrent} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
