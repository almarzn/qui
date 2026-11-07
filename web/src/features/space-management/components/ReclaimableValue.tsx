/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn, formatBytes } from "@/lib/utils"
import { useTranslation } from "react-i18next"

import { reclaimableDisplay } from "../lib/space-tree"

interface ReclaimableValueProps {
  bytes: number
  known: boolean
  className?: string
}

/** Reclaimable bytes, marked as a lower bound or unknown when some files could not be checked. */
export function ReclaimableValue({ bytes, known, className }: ReclaimableValueProps) {
  const { t } = useTranslation("spaceManagement")
  const display = reclaimableDisplay(bytes, known)

  if (display.kind === "known") {
    return <span className={className}>{formatBytes(display.bytes)}</span>
  }

  const text = display.kind === "atLeast"
    ? t("reclaimable.atLeast", { size: formatBytes(display.bytes) })
    : t("reclaimable.unknown")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-help text-muted-foreground underline decoration-dotted underline-offset-2", className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("reclaimable.unknownHint")}</TooltipContent>
    </Tooltip>
  )
}
