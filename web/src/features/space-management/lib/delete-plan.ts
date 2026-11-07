/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import type { SpaceDeleteAction, SpaceNode } from "../types"

export interface DeleteActionGroup {
  nodeId: string
  title: string
  torrents: SpaceDeleteAction[]
  files: SpaceDeleteAction[]
}

/** Groups delete actions per item, in the order the items were selected. */
export function groupDeleteActions(actions: SpaceDeleteAction[], nodes: SpaceNode[]): DeleteActionGroup[] {
  const groups = new Map<string, DeleteActionGroup>()
  for (const node of nodes) {
    groups.set(node.id, { nodeId: node.id, title: node.title, torrents: [], files: [] })
  }
  for (const action of actions) {
    let group = groups.get(action.nodeId)
    if (!group) {
      group = { nodeId: action.nodeId, title: action.nodeId, torrents: [], files: [] }
      groups.set(action.nodeId, group)
    }
    if (action.type === "deleteArrFile") group.files.push(action)
    else group.torrents.push(action)
  }
  return [...groups.values()].filter(group => group.torrents.length + group.files.length > 0)
}
