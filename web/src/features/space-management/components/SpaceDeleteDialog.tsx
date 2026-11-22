/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { cn, formatBytes } from "@/lib/utils"
import { ChevronRight, Loader2 } from "lucide-react"
import { useId, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { groupDeleteActions, type DeleteActionGroup } from "../lib/delete-plan"
import { useSpaceDelete, useSpaceDeletePlan } from "../queries"
import type { SpaceDeleteAction, SpaceNode } from "../types"

interface SpaceDeleteDialogProps {
  nodes: SpaceNode[]
  onClose: () => void
  onDeleted: () => void
}

function ActionStatus({ action }: { action: SpaceDeleteAction }) {
  const { t } = useTranslation("spaceManagement")
  if (action.status === "planned") return null
  return (
    <span className={cn("whitespace-nowrap text-xs", action.status === "error" ? "text-destructive" : "text-[var(--ratio-good)]")}>
      {t([`actionStatus.${action.status}`, "actionStatus.unknown"])}
    </span>
  )
}

function ActionLine({ kind, action, children }: { kind: string; action: SpaceDeleteAction; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5">
      <span className="text-muted-foreground">{kind}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      <ActionStatus action={action} />
      {action.error && <span className="col-start-2 col-end-4 text-destructive">{action.error}</span>}
    </li>
  )
}

function GroupRow({ group, node, showFrees, defaultOpen }: { group: DeleteActionGroup; node: SpaceNode | undefined; showFrees: boolean; defaultOpen: boolean }) {
  const { t } = useTranslation("spaceManagement")
  const crossSeeds = group.torrents.filter(action => action.isCrossSeed).length
  const counts = [
    group.torrents.length - crossSeeds > 0 ? t("deleteDialog.countTorrents", { n: group.torrents.length - crossSeeds }) : null,
    crossSeeds > 0 ? t("deleteDialog.countCrossSeeds", { n: crossSeeds }) : null,
    group.files.length > 0 ? t("deleteDialog.countFiles", { n: group.files.length }) : null,
  ].filter(Boolean)

  return (
    <details className="group border-t first:border-t-0" open={defaultOpen}>
      <summary className="grid cursor-pointer list-none grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        <span className="grid min-w-0">
          <h4 className="truncate font-medium">{group.title}</h4>
          <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">{counts.map(count => <span key={count}>{count}</span>)}</span>
        </span>
        {showFrees && node && (
          <span className={cn("whitespace-nowrap text-right tabular-nums", node.reclaimableBytes === 0 && "text-muted-foreground")}>
            {formatBytes(node.reclaimableBytes)}
          </span>
        )}
      </summary>
      <ul className="grid gap-1.5 pb-3 pl-[38px] pr-3.5 text-xs">
        {group.torrents.map((action, index) => (
          <ActionLine key={`t|${action.target}|${index}`} kind={t("deleteDialog.kindTorrent")} action={action}>
            {action.target}
            {action.tracker && <span className="ml-1.5 text-muted-foreground">{action.tracker}</span>}
            {action.isCrossSeed && (
              <span className="ml-1.5 whitespace-nowrap rounded-full border px-1.5 text-[11px] text-muted-foreground">{t("details.crossSeed")}</span>
            )}
          </ActionLine>
        ))}
        {group.files.map((action, index) => (
          <ActionLine key={`f|${action.target}|${index}`} kind={t("deleteDialog.kindFile")} action={action}>
            <span className="font-mono text-[11.5px]">{action.target}</span>
          </ActionLine>
        ))}
      </ul>
    </details>
  )
}

function OptionRow({ id, checked, disabled, onChange, label, help, count }: {
  id: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  label: string
  help: string
  count: string | null
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-lg border px-3.5 py-3",
        checked && "border-foreground/30",
        disabled && "cursor-default opacity-70"
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
        className="mt-0.5"
      />
      <span id={`${id}-label`} className="text-sm font-medium">{label}</span>
      <span className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{count}</span>
      <span id={`${id}-help`} className="col-start-2 col-end-4 text-xs text-muted-foreground">{help}</span>
    </label>
  )
}

export function SpaceDeleteDialog({ nodes, onClose, onDeleted }: SpaceDeleteDialogProps) {
  const { t } = useTranslation("spaceManagement")
  const torrentsId = useId()
  const arrFilesId = useId()
  const [deleteTorrents, setDeleteTorrents] = useState(true)
  const [deleteArrFiles, setDeleteArrFiles] = useState(true)

  const nodeIds = useMemo(() => nodes.map(node => node.id), [nodes])
  const nodesById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const request = { nodeIds, deleteTorrents, deleteCrossSeeds: deleteTorrents, deleteArrFiles }
  const hasOption = deleteTorrents || deleteArrFiles

  const execute = useSpaceDelete()
  const plan = useSpaceDeletePlan(request, hasOption && execute.status === "idle")
  const result = execute.data
  const shown = result ?? (plan.isSuccess ? plan.data : undefined)
  const groups = useMemo(() => shown ? groupDeleteActions(shown.actions, nodes) : [], [shown, nodes])

  const selectedBytes = useMemo(() => nodes.reduce((sum, node) => sum + node.sizeBytes, 0), [nodes])
  const bestBytes = useMemo(() => nodes.reduce((sum, node) => sum + node.reclaimableBytes, 0), [nodes])
  const failed = result ? result.actions.filter(action => action.status === "error").length : 0
  const busy = execute.isPending
  const bothOptions = deleteTorrents && deleteArrFiles

  const planActions = plan.isSuccess ? plan.data.actions : []
  const crossSeedCount = planActions.filter(action => action.type === "deleteTorrent" && action.isCrossSeed).length
  const torrentCount = planActions.filter(action => action.type === "deleteTorrent").length - crossSeedCount
  const fileCount = planActions.filter(action => action.type === "deleteArrFile").length
  const torrentsCount = deleteTorrents && plan.isSuccess
    ? [t("deleteDialog.countTorrents", { n: torrentCount }), crossSeedCount > 0 ? t("deleteDialog.countCrossSeeds", { n: crossSeedCount }) : null].filter(Boolean).join(", ")
    : null
  const filesCount = deleteArrFiles && plan.isSuccess ? t("deleteDialog.countFiles", { n: fileCount }) : null

  const freedBytes = shown?.reclaimableBytes ?? 0
  const showFreed = !!shown && !(result && failed > 0)
  const missingBytes = !result && plan.isSuccess && hasOption && !bothOptions ? Math.max(0, bestBytes - plan.data.reclaimableBytes) : 0

  let title = t("deleteDialog.title")
  let description = t("deleteDialog.description", { items: nodes.length })
  if (result) {
    title = failed > 0 ? t("deleteDialog.partialTitle") : t("deleteDialog.doneTitle")
    description = failed > 0 ? t("deleteDialog.partialDescription") : t("deleteDialog.doneDescription")
  }

  const renderPlan = () => {
    if (!result && !hasOption) return <p className="text-sm text-muted-foreground">{t("deleteDialog.chooseOption")}</p>
    if (!result && plan.isPending) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("deleteDialog.planning")}
        </div>
      )
    }
    if (!result && plan.error) return <p className="text-sm text-destructive">{t("deleteDialog.planError", { error: plan.error.message })}</p>
    if (groups.length === 0) return <p className="text-sm text-muted-foreground">{t("deleteDialog.noActions")}</p>
    const showFrees = bothOptions && !result
    return (
      <div className="overflow-hidden rounded-lg border">
        <div className="flex justify-between bg-muted/50 px-3.5 py-2 text-xs text-muted-foreground">
          <span>{result ? t("deleteDialog.results") : t("deleteDialog.whatHappens")}</span>
          {showFrees && <span>{t("deleteDialog.freesColumn")}</span>}
        </div>
        {groups.map(group => (
          <GroupRow
            key={group.nodeId}
            group={group}
            node={nodesById.get(group.nodeId)}
            showFrees={showFrees}
            defaultOpen={groups.length <= 3 || [...group.torrents, ...group.files].some(action => action.status === "error")}
          />
        ))}
      </div>
    )
  }

  const canConfirm = hasOption && !result && !busy && plan.isSuccess && plan.data.actions.length > 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {showFreed && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-semibold leading-tight tracking-tight tabular-nums">
                  {result ? t("deleteDialog.freed", { size: formatBytes(freedBytes) }) : t("deleteDialog.frees", { size: formatBytes(freedBytes) })}
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">{t("deleteDialog.ofSelected", { size: formatBytes(selectedBytes) })}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-destructive transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${selectedBytes > 0 ? Math.min(100, (freedBytes / selectedBytes) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {!result && (
            <div className="grid gap-2">
              <OptionRow
                id={torrentsId}
                checked={deleteTorrents}
                disabled={busy}
                onChange={setDeleteTorrents}
                label={t("deleteDialog.optionTorrents")}
                help={t("deleteDialog.optionTorrentsHelp")}
                count={torrentsCount}
              />
              <OptionRow
                id={arrFilesId}
                checked={deleteArrFiles}
                disabled={busy}
                onChange={setDeleteArrFiles}
                label={t("deleteDialog.optionArrFiles")}
                help={t("deleteDialog.optionArrFilesHelp")}
                count={filesCount}
              />
            </div>
          )}

          {missingBytes > 0 && (
            <div className="flex gap-2.5 rounded-lg bg-[color-mix(in_oklab,var(--ratio-almost)_13%,transparent)] px-3 py-2.5 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--ratio-almost)]" />
              <span>{t("deleteDialog.bothHint", { size: formatBytes(missingBytes) })}</span>
            </div>
          )}

          {renderPlan()}

          {execute.error && (
            <p className="text-sm text-destructive">{t("deleteDialog.executeError", { error: execute.error.message })}</p>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-3.5">
          {result ? (
            <Button onClick={onClose}>{t("deleteDialog.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={busy}>{t("deleteDialog.cancel")}</Button>
              <Button variant="destructive" onClick={() => execute.mutate(request, { onSuccess: onDeleted })} disabled={!canConfirm}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy ? t("deleteDialog.deleting") : t("deleteDialog.confirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
