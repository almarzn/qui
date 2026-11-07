// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"os"
	"path/filepath"
	"testing"

	qbt "github.com/autobrr/go-qbittorrent"
	"github.com/stretchr/testify/require"

	"github.com/autobrr/qui/internal/fsops"
	localbackend "github.com/autobrr/qui/internal/fsops/local"
	"github.com/autobrr/qui/pkg/hardlink"
)

func testKey(t *testing.T, ino uint64) fsops.FileKey {
	t.Helper()
	key, ok := fsops.FileKeyOf(hardlink.UnixFileID(1, ino), nil)
	require.True(t, ok)
	return key
}

func keyed(t *testing.T, path string, ino uint64, nlink uint64, size int64) fileRef {
	return fileRef{path: path, size: size, key: testKey(t, ino), hasKey: true, nlink: nlink}
}

func entry(instanceID int, hash string, addedOn int64, contentPath string, files ...fileRef) *torrentEntry {
	return &torrentEntry{
		instanceID:   instanceID,
		instanceName: "qb",
		torrent:      qbt.Torrent{Hash: hash, Name: hash, AddedOn: addedOn, Size: 100, ContentPath: contentPath},
		contentPath:  contentPath,
		files:        files,
	}
}

func hashesOf(torrents []*torrentEntry, linked []linkedTorrent) []string {
	out := make([]string, len(linked))
	for i, lt := range linked {
		out[i] = torrents[lt.index].torrent.Hash
	}
	return out
}

func TestLinkTorrents(t *testing.T) {
	const season = "sonarr:1:season:7:1"
	const movie = "radarr:2:movie:9"

	// a: grabbed by Sonarr (history). c: a hardlinked cross-seed of a, added first.
	a := entry(1, "aaaa", 200, "/dl/Example.Show.S01", keyed(t, "/dl/Example.Show.S01/e1.mkv", 10, 3, 50))
	c := entry(2, "cccc", 100, "/xs/Example.Show.S01", keyed(t, "/xs/Example.Show.S01/e1.mkv", 10, 3, 50))
	// b: no history, its file is the movie's library file (inode fallback).
	b := entry(1, "bbbb", 300, "/dl/Sample.Movie.2001", keyed(t, "/dl/Sample.Movie.2001/m.mkv", 20, 2, 80))
	// d: same instance, content path and size as b, files unreadable.
	d := entry(1, "dddd", 400, "/dl/Sample.Movie.2001", fileRef{path: "/dl/Sample.Movie.2001/m.mkv", size: 80})
	// e: claimed by nothing.
	e := entry(1, "eeee", 500, "/dl/Unrelated.Release", keyed(t, "/dl/Unrelated.Release/u.bin", 30, 1, 10))
	// f: same content path as b but on another instance: not a cross-seed.
	f := entry(2, "ffff", 600, "/dl/Sample.Movie.2001", fileRef{path: "/dl/Sample.Movie.2001/m.mkv", size: 80})
	torrents := []*torrentEntry{a, b, c, d, e, f}

	history := map[string][]string{"AAAA": {season}}
	library := map[fsops.FileKey][]string{testKey(t, 20): {movie}}

	got := linkTorrents(torrents, history, library)

	require.Equal(t, []string{"aaaa", "cccc"}, hashesOf(torrents, got.byItem[season]))
	require.False(t, got.byItem[season][0].isCrossSeed)
	require.True(t, got.byItem[season][1].isCrossSeed)
	require.Equal(t, "aaaa", got.byItem[season][1].crossSeedOf)

	require.Equal(t, []string{"bbbb", "dddd"}, hashesOf(torrents, got.byItem[movie]))
	require.False(t, got.byItem[movie][0].isCrossSeed)
	require.Equal(t, "bbbb", got.byItem[movie][1].crossSeedOf)

	require.Len(t, got.orphans, 2)
	require.Equal(t, []string{"eeee"}, hashesOf(torrents, got.orphans[0]))
	require.Equal(t, []string{"ffff"}, hashesOf(torrents, got.orphans[1]))
}

func TestReclaimable(t *testing.T) {
	tests := []struct {
		name      string
		files     []fileRef
		wantBytes int64
		wantKnown bool
	}{
		{
			name:      "library file hardlinked to the torrent counts once",
			files:     []fileRef{keyed(t, "/lib/a.mkv", 1, 2, 100), keyed(t, "/dl/a.mkv", 1, 2, 100)},
			wantBytes: 100,
			wantKnown: true,
		},
		{
			name:      "a link outside the set keeps the file",
			files:     []fileRef{keyed(t, "/lib/a.mkv", 1, 3, 100), keyed(t, "/dl/a.mkv", 1, 3, 100), keyed(t, "/dl/b.mkv", 2, 1, 40)},
			wantBytes: 40,
			wantKnown: true,
		},
		{
			name:      "cross-seeds on the same path are one link",
			files:     []fileRef{keyed(t, "/dl/a.mkv", 1, 1, 100), keyed(t, "/dl/a.mkv", 1, 1, 100)},
			wantBytes: 100,
			wantKnown: true,
		},
		{
			name:      "an unreadable file is unknown and not counted",
			files:     []fileRef{keyed(t, "/dl/a.mkv", 1, 1, 100), {path: "/lib/b.mkv", size: 70}},
			wantBytes: 100,
			wantKnown: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotBytes, gotKnown := reclaimable(tt.files)
			require.Equal(t, tt.wantBytes, gotBytes)
			require.Equal(t, tt.wantKnown, gotKnown)
		})
	}
}

func TestPlanDeleteReclaimable(t *testing.T) {
	main := entry(1, "aaaa", 100, "/dl/Example.Show.S02", keyed(t, "/dl/Example.Show.S02/e1.mkv", 1, 3, 100))
	cross := entry(2, "bbbb", 200, "/xs/Example.Show.S02", keyed(t, "/xs/Example.Show.S02/e1.mkv", 1, 3, 100))
	main.torrent.Tracker = "https://main.example:8443/announce"
	cross.torrent.Tracker = "udp://cross.example:6969/announce"
	lib := &arrFile{arrInstanceID: 3, fileID: 11, ref: keyed(t, "/lib/Example Show/Season 02/e1.mkv", 1, 3, 100)}
	node := &Node{ID: "sonarr:3:season:5:2", plan: nodePlan{
		torrents: []plannedTorrent{{key: main.key()}, {key: cross.key(), isCrossSeed: true}},
		arrFiles: []*arrFile{lib},
	}}
	snap := &snapshot{
		byID:     map[string]*Node{node.ID: node},
		torrents: map[torrentKey]*torrentEntry{main.key(): main, cross.key(): cross},
	}

	tests := []struct {
		name        string
		req         DeleteRequest
		wantBytes   int64
		wantActions int
	}{
		{"everything frees the file", DeleteRequest{DeleteTorrents: true, DeleteCrossSeeds: true, DeleteArrFiles: true}, 100, 3},
		{"a kept cross-seed holds the file", DeleteRequest{DeleteTorrents: true, DeleteArrFiles: true}, 0, 2},
		{"a kept library file holds the file", DeleteRequest{DeleteTorrents: true, DeleteCrossSeeds: true}, 0, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.req.NodeIDs = []string{node.ID}
			plan, err := snap.planDelete(tt.req)
			require.NoError(t, err)
			require.Equal(t, tt.wantBytes, plan.resp.ReclaimableBytes)
			require.Len(t, plan.resp.Actions, tt.wantActions)
			for _, a := range plan.resp.Actions {
				require.Equal(t, StatusPlanned, a.Status)
			}
		})
	}

	t.Run("torrent actions tell the main from its cross-seed", func(t *testing.T) {
		plan, err := snap.planDelete(DeleteRequest{NodeIDs: []string{node.ID}, DeleteTorrents: true, DeleteCrossSeeds: true})
		require.NoError(t, err)
		require.Len(t, plan.resp.Actions, 2)
		require.Equal(t, "main.example", plan.resp.Actions[0].Tracker)
		require.False(t, *plan.resp.Actions[0].IsCrossSeed)
		require.Equal(t, "cross.example", plan.resp.Actions[1].Tracker)
		require.True(t, *plan.resp.Actions[1].IsCrossSeed)
	})

	_, err := snap.planDelete(DeleteRequest{NodeIDs: []string{"radarr:1:movie:404"}})
	require.ErrorIs(t, err, ErrUnknownNode)
}

func TestStatRefsSeesHardlinks(t *testing.T) {
	dir := t.TempDir()
	lib := filepath.Join(dir, "library.mkv")
	dl := filepath.Join(dir, "download.mkv")
	require.NoError(t, os.WriteFile(lib, []byte("0123456789"), 0o600))
	require.NoError(t, os.Link(lib, dl))

	refs := []*fileRef{{path: lib}, {path: dl}, {path: filepath.Join(dir, "missing.mkv"), size: 5}}
	statRefs(t.Context(), localbackend.NewBackend(), nil, refs)

	require.True(t, refs[0].hasKey)
	require.Equal(t, refs[0].key, refs[1].key)
	require.Equal(t, uint64(2), refs[0].nlink)
	require.Equal(t, int64(10), refs[0].size)
	require.False(t, refs[2].hasKey)

	bytes, known := reclaimable([]fileRef{*refs[0], *refs[1]})
	require.True(t, known)
	require.Equal(t, int64(10), bytes)
	bytes, _ = reclaimable([]fileRef{*refs[0]})
	require.Zero(t, bytes)
}
