// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"slices"
	"strings"

	qbt "github.com/autobrr/go-qbittorrent"

	"github.com/autobrr/qui/internal/fsops"
)

// fileRef is one path with the identity read from disk. hasKey is false when
// the stat failed or gave no identity; such a file never counts as reclaimable.
type fileRef struct {
	path   string
	size   int64
	key    fsops.FileKey
	hasKey bool
	nlink  uint64
}

type torrentKey struct {
	instanceID int
	hash       string
}

func keyOf(instanceID int, hash string) torrentKey {
	return torrentKey{instanceID: instanceID, hash: strings.ToLower(hash)}
}

type torrentEntry struct {
	instanceID   int
	instanceName string
	torrent      qbt.Torrent
	// contentPath is the torrent content path in the local view, used for the
	// same-path cross-seed match.
	contentPath string
	files       []fileRef
}

func (t *torrentEntry) key() torrentKey { return keyOf(t.instanceID, t.torrent.Hash) }

// hashVariants returns the uppercase infohashes the arr history may record.
func (t *torrentEntry) hashVariants() []string {
	out := make([]string, 0, 3)
	for _, h := range []string{t.torrent.Hash, t.torrent.InfohashV1, t.torrent.InfohashV2} {
		if h != "" {
			out = append(out, strings.ToUpper(h))
		}
	}
	return out
}

// linkedTorrent is one torrent of an item, with its role.
type linkedTorrent struct {
	index       int
	isCrossSeed bool
	crossSeedOf string
}

type linkResult struct {
	// byItem maps an item ID to its torrents, main first.
	byItem map[string][]linkedTorrent
	// orphans are cross-seed groups that no item claims, each main first.
	orphans [][]linkedTorrent
}

// groupCrossSeeds unions torrents that share a file identity, or that have the
// same content path and size on one instance.
func groupCrossSeeds(torrents []*torrentEntry) [][]int {
	parent := make([]int, len(torrents))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		for parent[i] != i {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[rb] = ra
		}
	}

	type pathKey struct {
		instanceID int
		path       string
		size       int64
	}
	byFile := make(map[fsops.FileKey]int)
	byPath := make(map[pathKey]int)
	for i, t := range torrents {
		for _, f := range t.files {
			if !f.hasKey {
				continue
			}
			if j, ok := byFile[f.key]; ok {
				union(j, i)
			} else {
				byFile[f.key] = i
			}
		}
		if t.contentPath == "" {
			continue
		}
		pk := pathKey{instanceID: t.instanceID, path: t.contentPath, size: t.torrent.Size}
		if j, ok := byPath[pk]; ok {
			union(j, i)
		} else {
			byPath[pk] = i
		}
	}

	groups := make(map[int][]int)
	var roots []int
	for i := range torrents {
		r := find(i)
		if _, ok := groups[r]; !ok {
			roots = append(roots, r)
		}
		groups[r] = append(groups[r], i)
	}
	out := make([][]int, 0, len(roots))
	for _, r := range roots {
		out = append(out, groups[r])
	}
	return out
}

// linkTorrents assigns torrents to items. History (downloadId == infohash) is
// the primary link; a torrent without one links to the items whose library
// files share an identity with its files. Every member of a cross-seed group
// follows the group's links.
func linkTorrents(torrents []*torrentEntry, historyByHash map[string][]string, libraryItemsByKey map[fsops.FileKey][]string) linkResult {
	direct := make([][]string, len(torrents))
	fromHistory := make([]bool, len(torrents))
	for i, t := range torrents {
		for _, h := range t.hashVariants() {
			if items := historyByHash[h]; len(items) > 0 {
				direct[i] = appendUnique(direct[i], items...)
				fromHistory[i] = true
			}
		}
		if fromHistory[i] {
			continue
		}
		for _, f := range t.files {
			if f.hasKey {
				direct[i] = appendUnique(direct[i], libraryItemsByKey[f.key]...)
			}
		}
	}

	result := linkResult{byItem: make(map[string][]linkedTorrent)}
	for _, group := range groupCrossSeeds(torrents) {
		members := orderGroup(torrents, group, fromHistory)
		var items []string
		for _, i := range group {
			items = appendUnique(items, direct[i]...)
		}
		if len(items) == 0 {
			result.orphans = append(result.orphans, members)
			continue
		}
		for _, item := range items {
			result.byItem[item] = append(result.byItem[item], members...)
		}
	}
	return result
}

// orderGroup puts the main torrent first and marks the rest as its
// cross-seeds. Torrents linked by history are all mains; without one, the
// oldest torrent is the main.
func orderGroup(torrents []*torrentEntry, group []int, fromHistory []bool) []linkedTorrent {
	sorted := slices.Clone(group)
	slices.SortStableFunc(sorted, func(a, b int) int {
		if fromHistory[a] != fromHistory[b] {
			if fromHistory[a] {
				return -1
			}
			return 1
		}
		if c := compareInt64(torrents[a].torrent.AddedOn, torrents[b].torrent.AddedOn); c != 0 {
			return c
		}
		return strings.Compare(torrents[a].torrent.Hash, torrents[b].torrent.Hash)
	})
	mainHash := torrents[sorted[0]].torrent.Hash
	out := make([]linkedTorrent, 0, len(sorted))
	for n, i := range sorted {
		lt := linkedTorrent{index: i}
		if n > 0 && !fromHistory[i] {
			lt.isCrossSeed = true
			lt.crossSeedOf = mainHash
		}
		out = append(out, lt)
	}
	return out
}

func compareInt64(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func appendUnique(dst []string, values ...string) []string {
	for _, v := range values {
		if !slices.Contains(dst, v) {
			dst = append(dst, v)
		}
	}
	return dst
}

// reclaimable returns the bytes that deleting every path in files frees. Each
// identity counts once, and only when every one of its links is in the set.
// known is false when any file has no identity.
func reclaimable(files []fileRef) (bytes int64, known bool) {
	known = true
	type group struct {
		paths map[string]struct{}
		nlink uint64
		size  int64
	}
	groups := make(map[fsops.FileKey]*group)
	var order []fsops.FileKey
	for _, f := range files {
		if !f.hasKey {
			known = false
			continue
		}
		g, ok := groups[f.key]
		if !ok {
			g = &group{paths: make(map[string]struct{})}
			groups[f.key] = g
			order = append(order, f.key)
		}
		g.paths[f.path] = struct{}{}
		g.nlink = max(g.nlink, f.nlink)
		g.size = max(g.size, f.size)
	}
	for _, k := range order {
		g := groups[k]
		if uint64(len(g.paths)) >= g.nlink {
			bytes += g.size
		}
	}
	return bytes, known
}

// uniqueSize sums the size of files, counting each identity once and each
// path without an identity once.
func uniqueSize(files []fileRef) int64 {
	var total int64
	seenKeys := make(map[fsops.FileKey]struct{})
	seenPaths := make(map[string]struct{})
	for _, f := range files {
		if f.hasKey {
			if _, ok := seenKeys[f.key]; ok {
				continue
			}
			seenKeys[f.key] = struct{}{}
		} else {
			if _, ok := seenPaths[f.path]; ok {
				continue
			}
			seenPaths[f.path] = struct{}{}
		}
		total += f.size
	}
	return total
}
