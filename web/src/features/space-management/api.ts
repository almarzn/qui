/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import i18n from "@/i18n"
import { APIError } from "@/lib/api"
import { getApiBaseUrl } from "@/lib/base-url"

import type { SpaceDeleteRequest, SpaceDeleteResponse, SpaceOverview, SpaceTree } from "./types"

// The feature keeps its own small client instead of growing the shared ApiClient,
// so it can move into an extension later without touching lib/api.ts.
async function spaceRequest<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/space${endpoint}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let message = i18n.t("errors.httpStatus", { ns: "common", status: response.status })
    let data: unknown
    try {
      data = await response.json()
      const parsed = (data as { error?: unknown; message?: unknown } | null)
      const candidate = parsed?.error ?? parsed?.message
      if (typeof candidate === "string" && candidate.trim() !== "") message = candidate
    } catch {
      // Non-JSON error body (proxy page); keep the status message.
    }
    throw new APIError(message, response.status, data)
  }

  return response.json() as Promise<T>
}

export const spaceApi = {
  getOverview: () => spaceRequest<SpaceOverview>("/overview"),
  getTree: (refresh = false) => spaceRequest<SpaceTree>(`/tree${refresh ? "?refresh=true" : ""}`),
  delete: (body: SpaceDeleteRequest) => spaceRequest<SpaceDeleteResponse>("/delete", {
    method: "POST",
    body: JSON.stringify(body),
  }),
}
