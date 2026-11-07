/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SearchInput } from "@/components/ui/SearchInput"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, SlidersHorizontal } from "lucide-react"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import {
  activeQuickFilter,
  applyQuickFilter,
  QUICK_FILTERS,
  type QuickFilter,
  type SpaceFilterInputs,
  type SpaceSort,
  type SpaceSortKey
} from "../lib/space-tree"

export type SpaceView = "list" | "treemap"

const QUICK_FILTER_KEYS: Record<QuickFilter, string> = {
  all: "filters.quick.all",
  lowRatio: "filters.quick.lowRatio",
  inactive: "filters.quick.inactive",
  notSeeded: "filters.quick.notSeeded",
}

interface SpaceFiltersBarProps {
  inputs: SpaceFilterInputs
  onInputsChange: (inputs: SpaceFilterInputs) => void
  sort: SpaceSort
  onSortChange: (sort: SpaceSort) => void
  view: SpaceView
  onViewChange: (view: SpaceView) => void
}

function NumberField({ label, value, onChange, step }: { label: string; value: string; onChange: (value: string) => void; step: string }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-24"
      />
    </div>
  )
}

export function SpaceFiltersBar({ inputs, onInputsChange, sort, onSortChange, view, onViewChange }: SpaceFiltersBarProps) {
  const { t } = useTranslation("spaceManagement")
  const update = (patch: Partial<SpaceFilterInputs>) => onInputsChange({ ...inputs, ...patch })
  const activeQuick = activeQuickFilter(inputs)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("filters.quickLabel")}>
        {QUICK_FILTERS.map(quick => (
          <Button
            key={quick}
            variant={activeQuick === quick ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={activeQuick === quick}
            className={cn("h-7 rounded-full px-3", activeQuick === quick && "font-semibold")}
            onClick={() => onInputsChange(applyQuickFilter(inputs, quick))}
          >
            {t(QUICK_FILTER_KEYS[quick])}
          </Button>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={activeQuick === null ? "secondary" : "ghost"}
              size="sm"
              className="h-7 rounded-full px-3"
            >
              <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
              {t("filters.more")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <NumberField label={t("filters.ratioBelow")} value={inputs.ratioBelow} step="0.1" onChange={(ratioBelow) => update({ ratioBelow })} />
            <NumberField
              label={t("filters.seedingLongerThan")}
              value={inputs.seedingLongerThanDays}
              step="1"
              onChange={(seedingLongerThanDays) => update({ seedingLongerThanDays })}
            />
            <NumberField
              label={t("filters.inactiveFor")}
              value={inputs.inactiveForDays}
              step="1"
              onChange={(inactiveForDays) => update({ inactiveForDays })}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="w-48">
          <SearchInput
            value={inputs.search}
            placeholder={t("filters.searchPlaceholder")}
            onChange={(event) => update({ search: event.target.value })}
            onClear={() => update({ search: "" })}
            className="h-8"
          />
        </div>
        <Select value={sort.key} onValueChange={(key) => onSortChange({ ...sort, key: key as SpaceSortKey })}>
          <SelectTrigger className="h-8 w-32" aria-label={t("filters.sortBy")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="size">{t("filters.sortSize")}</SelectItem>
            <SelectItem value="reclaimable">{t("filters.sortReclaimable")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onSortChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}
          aria-label={sort.direction === "asc" ? t("filters.ascending") : t("filters.descending")}
          title={sort.direction === "asc" ? t("filters.ascending") : t("filters.descending")}
        >
          {sort.direction === "asc" ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownWideNarrow className="h-4 w-4" />}
        </Button>
        <div className="flex rounded-md border" role="group" aria-label={t("view.label")}>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-r-none"
            aria-pressed={view === "list"}
            aria-label={t("view.list")}
            title={t("view.list")}
            onClick={() => onViewChange("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "treemap" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-l-none"
            aria-pressed={view === "treemap"}
            aria-label={t("view.treemap")}
            title={t("view.treemap")}
            onClick={() => onViewChange("treemap")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
