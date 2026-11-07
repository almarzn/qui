/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchInput } from "@/components/ui/SearchInput"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import { EMPTY_FILTER_INPUTS, type SpaceFilterInputs, type SpaceSort, type SpaceSortKey } from "../lib/space-tree"

interface SpaceFiltersBarProps {
  inputs: SpaceFilterInputs
  onInputsChange: (inputs: SpaceFilterInputs) => void
  sort: SpaceSort
  onSortChange: (sort: SpaceSort) => void
}

function NumberField({ label, value, onChange, step }: { label: string; value: string; onChange: (value: string) => void; step: string }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-36"
      />
    </div>
  )
}

export function SpaceFiltersBar({ inputs, onInputsChange, sort, onSortChange }: SpaceFiltersBarProps) {
  const { t } = useTranslation("spaceManagement")
  const sortId = useId()
  const update = (patch: Partial<SpaceFilterInputs>) => onInputsChange({ ...inputs, ...patch })
  const isDirty = Object.values(inputs).some(value => value !== "")

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full sm:w-64">
        <SearchInput
          value={inputs.search}
          placeholder={t("filters.searchPlaceholder")}
          onChange={(event) => update({ search: event.target.value })}
          onClear={() => update({ search: "" })}
          className="h-8"
        />
      </div>
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
      <div className="space-y-1">
        <Label htmlFor={sortId} className="text-xs text-muted-foreground">{t("filters.sortBy")}</Label>
        <div className="flex items-center gap-1">
          <Select value={sort.key} onValueChange={(key) => onSortChange({ ...sort, key: key as SpaceSortKey })}>
            <SelectTrigger id={sortId} className="h-8 w-36">
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
        </div>
      </div>
      {isDirty && (
        <Button variant="ghost" size="sm" className="h-8" onClick={() => onInputsChange(EMPTY_FILTER_INPUTS)}>
          {t("filters.reset")}
        </Button>
      )}
    </div>
  )
}
