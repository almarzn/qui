/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Badge } from "@/components/ui/badge"
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
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { useSpaceDelete, useSpaceDeletePlan } from "../queries"
import type { SpaceDeleteAction, SpaceNode } from "../types"

interface SpaceDeleteDialogProps {
  nodes: SpaceNode[]
  onClose: () => void
  onDeleted: () => void
}

function ActionList({ actions, titles }: { actions: SpaceDeleteAction[]; titles: ReadonlyMap<string, string> }) {
  const { t } = useTranslation("spaceManagement")
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
      {actions.map((action, index) => (
        <li key={`${action.nodeId}|${action.type}|${action.target}|${index}`} className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={action.status === "error" ? "destructive" : "secondary"}>
              {t([`actionStatus.${action.status}`, "actionStatus.unknown"])}
            </Badge>
            <span className="font-medium">{t([`actionTypes.${action.type}`, "actionTypes.unknown"])}</span>
            <span className="text-muted-foreground">{titles.get(action.nodeId) ?? ""}</span>
          </div>
          <div className="break-all font-mono text-muted-foreground">{action.target}</div>
          {action.error && <div className="text-destructive">{action.error}</div>}
        </li>
      ))}
    </ul>
  )
}

/**
 * Confirmation for a bulk delete. A dry run fills the plan and the space it frees;
 * the real run uses the same options. Mount it only while open, so each open starts fresh.
 */
export function SpaceDeleteDialog({ nodes, onClose, onDeleted }: SpaceDeleteDialogProps) {
  const { t } = useTranslation("spaceManagement")
  const torrentsId = useId()
  const arrFilesId = useId()
  const [deleteTorrents, setDeleteTorrents] = useState(true)
  const [deleteArrFiles, setDeleteArrFiles] = useState(true)

  const nodeIds = useMemo(() => nodes.map(node => node.id), [nodes])
  const titles = useMemo(() => new Map(nodes.map(node => [node.id, node.title])), [nodes])
  const request = { nodeIds, deleteTorrents, deleteCrossSeeds: deleteTorrents, deleteArrFiles }
  const hasOption = deleteTorrents || deleteArrFiles

  const execute = useSpaceDelete()
  const plan = useSpaceDeletePlan(request, hasOption && execute.status === "idle")
  const result = execute.data

  const handleConfirm = () => {
    execute.mutate(request, { onSuccess: onDeleted })
  }

  const renderBody = () => {
    if (result) {
      return (
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("deleteDialog.results")}</div>
          <ActionList actions={result.actions} titles={titles} />
        </div>
      )
    }
    if (!hasOption) {
      return <p className="text-sm text-muted-foreground">{t("deleteDialog.chooseOption")}</p>
    }
    if (plan.isPending) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("deleteDialog.planning")}
        </div>
      )
    }
    if (plan.error) {
      return <p className="text-sm text-destructive">{t("deleteDialog.planError", { error: plan.error.message })}</p>
    }
    if (plan.data.actions.length === 0) {
      return <p className="text-sm text-muted-foreground">{t("deleteDialog.noActions")}</p>
    }
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium">
          {t("deleteDialog.reclaimable", { size: formatBytes(plan.data.reclaimableBytes) })}
        </div>
        <div className="text-xs text-muted-foreground">{t("deleteDialog.plannedActions")}</div>
        <ActionList actions={plan.data.actions} titles={titles} />
      </div>
    )
  }

  const canConfirm = hasOption && !result && !execute.isPending && plan.isSuccess && plan.data.actions.length > 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !execute.isPending) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
          <DialogDescription>{t("deleteDialog.description", { count: nodes.length })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id={torrentsId}
                checked={deleteTorrents}
                disabled={!!result || execute.isPending}
                onCheckedChange={(checked) => setDeleteTorrents(checked === true)}
              />
              <div className="space-y-0.5">
                <Label htmlFor={torrentsId}>{t("deleteDialog.optionTorrents")}</Label>
                <p className="text-xs text-muted-foreground">{t("deleteDialog.optionTorrentsHelp")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id={arrFilesId}
                checked={deleteArrFiles}
                disabled={!!result || execute.isPending}
                onCheckedChange={(checked) => setDeleteArrFiles(checked === true)}
              />
              <div className="space-y-0.5">
                <Label htmlFor={arrFilesId}>{t("deleteDialog.optionArrFiles")}</Label>
                <p className="text-xs text-muted-foreground">{t("deleteDialog.optionArrFilesHelp")}</p>
              </div>
            </div>
          </div>

          {renderBody()}

          {execute.error && (
            <p className="text-sm text-destructive">{t("deleteDialog.executeError", { error: execute.error.message })}</p>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>{t("deleteDialog.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={execute.isPending}>{t("deleteDialog.cancel")}</Button>
              <Button variant="destructive" onClick={handleConfirm} disabled={!canConfirm}>
                {execute.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {execute.isPending ? t("deleteDialog.deleting") : t("deleteDialog.confirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
