// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"encoding/base64"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/autobrr/qui/internal/fsops"
	"github.com/autobrr/qui/internal/models"
)

type nodeBuilder struct {
	snap    *snapshot
	entries []*torrentEntry
}

func (b *nodeBuilder) add(n *Node) {
	b.snap.nodes = append(b.snap.nodes, n)
	b.snap.byID[n.ID] = n
	for _, c := range n.Children {
		b.snap.byID[c.ID] = c
	}
}

func (b *nodeBuilder) addArrNodes(arrs []*arrSource, library []*arrFile, links linkResult, historySeasons map[string][]int) {
	filesByItem := make(map[string][]*arrFile)
	for _, f := range library {
		filesByItem[f.itemID] = append(filesByItem[f.itemID], f)
	}
	for _, a := range arrs {
		if a.err != nil {
			continue
		}
		inst := a.instance
		for _, sr := range a.series {
			sid := seriesID(inst.ID, sr.ID)
			var seasons []int
			for _, ef := range a.episodeFiles[sr.ID] {
				if !slices.Contains(seasons, ef.SeasonNumber) {
					seasons = append(seasons, ef.SeasonNumber)
				}
			}
			for _, n := range historySeasons[sid] {
				if !slices.Contains(seasons, n) && len(links.byItem[seasonID(inst.ID, sr.ID, n)]) > 0 {
					seasons = append(seasons, n)
				}
			}
			if len(seasons) == 0 {
				continue
			}
			slices.Sort(seasons)
			series := &Node{
				ID:      sid,
				Kind:    KindSeries,
				Title:   sr.Title,
				Year:    sr.Year,
				AddedAt: formatTime(sr.Added),
			}
			setArr(series, inst)
			for _, n := range seasons {
				id := seasonID(inst.ID, sr.ID, n)
				season := b.leaf(id, KindSeason, "Season "+strconv.Itoa(n), filesByItem[id], links.byItem[id])
				setArr(season, inst)
				if len(season.LibraryPaths) == 0 && sr.Path != "" {
					season.LibraryPaths = []string{sr.Path}
				}
				series.Children = append(series.Children, season)
			}
			b.rollUp(series)
			series.LibraryPaths = []string{}
			if sr.Path != "" {
				series.LibraryPaths = []string{sr.Path}
			}
			b.add(series)
		}
		for _, m := range a.movies {
			id := movieID(inst.ID, m.ID)
			if len(filesByItem[id]) == 0 && len(links.byItem[id]) == 0 {
				continue
			}
			movie := b.leaf(id, KindMovie, m.Title, filesByItem[id], links.byItem[id])
			movie.Year = m.Year
			if movie.AddedAt == "" {
				movie.AddedAt = formatTime(m.Added)
			}
			if m.Path != "" {
				movie.LibraryPaths = []string{m.Path}
			}
			setArr(movie, inst)
			b.add(movie)
		}
	}
	for _, n := range b.snap.nodes {
		b.snap.totals.TrackedBytes += n.SizeBytes
		b.snap.totals.ReclaimableBytes += n.ReclaimableBytes
	}
}

func setArr(n *Node, inst *models.ArrInstance) {
	n.ArrInstanceID = inst.ID
	n.ArrInstanceName = inst.Name
	n.ArrType = string(inst.Type)
}

func (b *nodeBuilder) addOrphanTorrents(groups [][]linkedTorrent) {
	for _, group := range groups {
		main := b.entries[group[0].index]
		n := b.leaf("orphan:torrent:"+strconv.Itoa(main.instanceID)+":"+strings.ToLower(main.torrent.Hash), KindOrphanTorrent, main.torrent.Name, nil, group)
		b.snap.totals.OrphanTorrentBytes += n.SizeBytes
		b.add(n)
	}
}

// addOrphanFiles adds the library files that share no identity with a torrent
// file. A file qui could not read is left out, since nothing says it is unseeded.
func (b *nodeBuilder) addOrphanFiles(library []*arrFile, entries []*torrentEntry) {
	seeded := make(map[fsops.FileKey]struct{})
	for _, e := range entries {
		for _, f := range e.files {
			if f.hasKey {
				seeded[f.key] = struct{}{}
			}
		}
	}
	for _, f := range library {
		if !f.ref.hasKey {
			continue
		}
		if _, ok := seeded[f.ref.key]; ok {
			continue
		}
		id := "orphan:file:" + base64.RawURLEncoding.EncodeToString([]byte(f.ref.path))
		if _, dup := b.snap.byID[id]; dup {
			continue
		}
		n := b.leaf(id, KindOrphanFile, f.itemTitle+" - "+baseOf(f.ref.path), []*arrFile{f}, nil)
		n.ArrInstanceID = f.arrInstanceID
		n.ArrInstanceName = f.arrInstanceName
		n.ArrType = string(f.arrType)
		b.snap.totals.OrphanFileBytes += n.SizeBytes
		b.add(n)
	}
}

// leaf builds a season, movie, or orphan node from its library files and torrents.
func (b *nodeBuilder) leaf(id, kind, title string, files []*arrFile, torrents []linkedTorrent) *Node {
	n := &Node{
		ID:            id,
		Kind:          kind,
		Title:         title,
		LibraryPaths:  []string{},
		DownloadPaths: []string{},
		Torrents:      []Torrent{},
	}
	var torrentRefs []fileRef
	for _, lt := range torrents {
		e := b.entries[lt.index]
		n.plan.torrents = append(n.plan.torrents, plannedTorrent{key: e.key(), isCrossSeed: lt.isCrossSeed})
		n.Torrents = append(n.Torrents, torrentJSON(e, lt))
		if e.contentPath != "" && !slices.Contains(n.DownloadPaths, e.contentPath) {
			n.DownloadPaths = append(n.DownloadPaths, e.contentPath)
		}
		torrentRefs = append(torrentRefs, e.files...)
	}
	n.plan.arrFiles = files

	qualities := make(map[string]int)
	var added time.Time
	for _, f := range files {
		if dir := dirOf(f.ref.path); dir != "" && !slices.Contains(n.LibraryPaths, dir) {
			n.LibraryPaths = append(n.LibraryPaths, dir)
		}
		if f.quality != "" {
			qualities[f.quality]++
		}
		if f.added.After(added) {
			added = f.added
		}
	}
	n.Quality = dominant(qualities)
	n.AddedAt = formatTime(added)
	n.Files = mergeFiles(files, torrentRefs)
	b.finish(n)
	return n
}

// rollUp fills a series from its seasons.
func (b *nodeBuilder) rollUp(n *Node) {
	n.Files = []File{}
	n.DownloadPaths = []string{}
	n.Torrents = []Torrent{}
	qualities := make(map[string]int)
	seen := make(map[torrentKey]struct{})
	for _, c := range n.Children {
		n.plan.arrFiles = append(n.plan.arrFiles, c.plan.arrFiles...)
		for i, pt := range c.plan.torrents {
			if _, ok := seen[pt.key]; ok {
				continue
			}
			seen[pt.key] = struct{}{}
			n.plan.torrents = append(n.plan.torrents, pt)
			n.Torrents = append(n.Torrents, c.Torrents[i])
		}
		for _, p := range c.DownloadPaths {
			if !slices.Contains(n.DownloadPaths, p) {
				n.DownloadPaths = append(n.DownloadPaths, p)
			}
		}
		if c.Quality != "" {
			qualities[c.Quality]++
		}
	}
	if len(qualities) == 1 {
		n.Quality = dominant(qualities)
	}
	b.finish(n)
}

// finish sets size, reclaimable bytes and stats from the node's plan.
func (b *nodeBuilder) finish(n *Node) {
	refs := b.snap.planRefs(n.plan.arrFiles, n.plan.torrents)
	n.SizeBytes = uniqueSize(refs)
	n.ReclaimableBytes, n.ReclaimableKnown = reclaimable(refs)
	var entries []*torrentEntry
	for _, pt := range n.plan.torrents {
		entries = append(entries, b.snap.torrents[pt.key])
	}
	n.Stats = rollUpStats(entries)
}

func (s *snapshot) planRefs(files []*arrFile, torrents []plannedTorrent) []fileRef {
	var refs []fileRef
	for _, f := range files {
		refs = append(refs, f.ref)
	}
	for _, pt := range torrents {
		if e := s.torrents[pt.key]; e != nil {
			refs = append(refs, e.files...)
		}
	}
	return refs
}

// mergeFiles lists library files first, then torrent files; a torrent file
// that is a link of a listed file joins that entry.
func mergeFiles(library []*arrFile, torrentRefs []fileRef) []File {
	out := []File{}
	byKey := make(map[fsops.FileKey]int)
	byPath := make(map[string]struct{})
	for _, f := range library {
		if f.ref.hasKey {
			if _, ok := byKey[f.ref.key]; ok {
				continue
			}
			byKey[f.ref.key] = len(out)
		}
		out = append(out, fileJSON(f.ref, true))
	}
	for _, r := range torrentRefs {
		if r.hasKey {
			if i, ok := byKey[r.key]; ok {
				if out[i].DownloadPath == "" {
					out[i].DownloadPath = r.path
				}
				continue
			}
			byKey[r.key] = len(out)
		} else {
			if _, ok := byPath[r.path]; ok {
				continue
			}
			byPath[r.path] = struct{}{}
		}
		out = append(out, fileJSON(r, false))
	}
	return out
}

func fileJSON(r fileRef, library bool) File {
	f := File{SizeBytes: r.size}
	if library {
		f.LibraryPath = r.path
	} else {
		f.DownloadPath = r.path
	}
	if r.hasKey {
		count := r.nlink
		f.LinkCount = &count
		f.Hardlinked = count > 1
	}
	return f
}

func torrentJSON(e *torrentEntry, lt linkedTorrent) Torrent {
	t := e.torrent
	return Torrent{
		InstanceID:         e.instanceID,
		InstanceName:       e.instanceName,
		Hash:               t.Hash,
		Name:               t.Name,
		Tracker:            trackerHost(t.Tracker),
		SavePath:           t.SavePath,
		ContentPath:        t.ContentPath,
		SizeBytes:          t.Size,
		Uploaded:           t.Uploaded,
		Downloaded:         t.Downloaded,
		Ratio:              t.Ratio,
		SeedingTimeSeconds: t.SeedingTime,
		LastActivity:       formatUnix(t.LastActivity),
		AddedOn:            formatUnix(t.AddedOn),
		State:              string(t.State),
		IsCrossSeed:        lt.isCrossSeed,
		CrossSeedOf:        lt.crossSeedOf,
	}
}

// rollUpStats sums transfer over torrents. The ratio divides by the bytes
// downloaded, or by the largest torrent when every torrent was a cross-seed
// that downloaded nothing.
func rollUpStats(entries []*torrentEntry) Stats {
	var st Stats
	var lastActivity, largest int64
	for _, e := range entries {
		if e == nil {
			continue
		}
		t := e.torrent
		st.Uploaded += t.Uploaded
		st.Downloaded += t.Downloaded
		st.SeedingTimeSeconds = max(st.SeedingTimeSeconds, t.SeedingTime)
		lastActivity = max(lastActivity, t.LastActivity)
		largest = max(largest, t.Size)
	}
	switch {
	case st.Downloaded > 0:
		st.Ratio = float64(st.Uploaded) / float64(st.Downloaded)
	case largest > 0:
		st.Ratio = float64(st.Uploaded) / float64(largest)
	}
	if v := formatUnix(lastActivity); v != "" {
		st.LastActivity = &v
	}
	return st
}

func trackerHost(tracker string) string {
	if tracker == "" {
		return ""
	}
	u, err := url.Parse(tracker)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

func dominant(counts map[string]int) string {
	best, bestCount := "", 0
	for q, c := range counts {
		if c > bestCount || (c == bestCount && q < best) {
			best, bestCount = q, c
		}
	}
	return best
}

func formatTime(t time.Time) string {
	if t.IsZero() || t.Year() <= 1 {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func formatUnix(sec int64) string {
	if sec <= 0 {
		return ""
	}
	return time.Unix(sec, 0).UTC().Format(time.RFC3339)
}
