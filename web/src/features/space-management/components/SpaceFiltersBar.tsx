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
  type SpaceSection,
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

const SECTION_KEYS: Record<SpaceSection, string> = {
  library: "sections.library",
  orphans: "sections.orphans",
}

interface SpaceFiltersBarProps {
  section: SpaceSection
  onSectionChange: (section: SpaceSection) => void
  sectionCounts: Record<SpaceSection, number>
  quickCounts: Record<QuickFilter, number>
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

export function SpaceFiltersBar({ section, onSectionChange, sectionCounts, quickCounts, inputs, onInputsChange, sort, onSortChange, view, onViewChange }: SpaceFiltersBarProps) {
  const { t } = useTranslation("spaceManagement")
  const update = (patch: Partial<SpaceFilterInputs>) => onInputsChange({ ...inputs, ...patch })
  const activeQuick = activeQuickFilter(inputs)

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b">
        <div className="flex gap-5" role="tablist" aria-label={t("sections.label")}>
          {(["library", "orphans"] as const).map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={section === key}
              onClick={() => onSectionChange(key)}
              className={cn(
                "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
                section === key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t(SECTION_KEYS[key])}
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{sectionCounts[key]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Select value={sort.key} onValueChange={(key) => onSortChange({ ...sort, key: key as SpaceSortKey })}>
            <SelectTrigger className="h-8 w-36" aria-label={t("filters.sortBy")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reclaimable">{t("filters.sortReclaimable")}</SelectItem>
              <SelectItem value="size">{t("filters.sortSize")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onSortChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}
            aria-label={sort.direction === "asc" ? t("filters.ascending") : t("filters.descending")}
            title={sort.direction === "asc" ? t("filters.ascending") : t("filters.descending")}
          >
            {sort.direction === "asc" ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownWideNarrow className="h-4 w-4" />}
          </Button>
          <div className="flex rounded-md bg-muted p-0.5" role="group" aria-label={t("view.label")}>
            {([["list", List, "view.list"], ["treemap", LayoutGrid, "view.treemap"]] as const).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                aria-label={t(label)}
                title={t(label)}
                onClick={() => onViewChange(key)}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground",
                  view === key && "bg-background text-foreground shadow-sm"
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-[200px] flex-1">
          <SearchInput
            value={inputs.search}
            placeholder={t("filters.searchPlaceholder")}
            onChange={(event) => update({ search: event.target.value })}
            onClear={() => update({ search: "" })}
            className="h-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-[3px]" role="group" aria-label={t("filters.quickLabel")}>
          {QUICK_FILTERS.map(quick => (
            <button
              key={quick}
              type="button"
              aria-pressed={activeQuick === quick}
              onClick={() => onInputsChange(applyQuickFilter(inputs, quick))}
              className={cn(
                "h-[30px] rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                activeQuick === quick && "bg-background text-foreground shadow-sm"
              )}
            >
              {t(QUICK_FILTER_KEYS[quick])}
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{quickCounts[quick]}</span>
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-[30px] items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  activeQuick === null && "bg-background text-foreground shadow-sm"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t("filters.more")}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
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
      </div>
    </div>
  )
}
