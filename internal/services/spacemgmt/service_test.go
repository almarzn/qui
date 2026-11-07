// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	qbt "github.com/autobrr/go-qbittorrent"
	"github.com/stretchr/testify/require"

	"github.com/autobrr/qui/internal/fsops"
	"github.com/autobrr/qui/internal/models"
)

type fakeArrStore struct{ instances []*models.ArrInstance }

func (f *fakeArrStore) ListEnabled(context.Context) ([]*models.ArrInstance, error) {
	return f.instances, nil
}
func (f *fakeArrStore) GetDecryptedAPIKey(*models.ArrInstance) (string, error)        { return "k", nil }
func (f *fakeArrStore) GetDecryptedBasicPassword(*models.ArrInstance) (string, error) { return "", nil }

type fakeInstances struct{ instances []*models.Instance }

func (f *fakeInstances) List(context.Context) ([]*models.Instance, error) { return f.instances, nil }

type fakeTorrents struct {
	torrents map[int][]qbt.Torrent
	files    map[string]qbt.TorrentFiles
	deleted  map[int][]string
}

func (f *fakeTorrents) GetAllTorrents(_ context.Context, id int) ([]qbt.Torrent, error) {
	return f.torrents[id], nil
}

func (f *fakeTorrents) GetTorrentFilesBatch(context.Context, int, []string) (map[string]qbt.TorrentFiles, error) {
	return f.files, nil
}

func (f *fakeTorrents) BulkAction(_ context.Context, id int, hashes []string, action string) error {
	if action != "deleteWithFiles" {
		return errors.New("unexpected action " + action)
	}
	f.deleted[id] = append(f.deleted[id], hashes...)
	return nil
}

func (f *fakeTorrents) GetFreeSpace(context.Context, int) (int64, error) { return 0, errors.New("n/a") }

// qui cannot read qBittorrent's disk, as in a container that only shares the arr view.
type noBackend struct{}

func (noBackend) Resolve(context.Context, int) (fsops.Backend, models.FilesystemMode, error) {
	return nil, "", errors.New("no filesystem access")
}

func TestServiceBuildsTreeThroughRemotePathMapping(t *testing.T) {
	root := t.TempDir()
	downloads := filepath.Join(root, "downloads")
	libDir := filepath.Join(root, "tv", "Example Show", "Season 01")
	require.NoError(t, os.MkdirAll(filepath.Join(downloads, "Example.Show.S01"), 0o750))
	require.NoError(t, os.MkdirAll(libDir, 0o750))
	dlFile := filepath.Join(downloads, "Example.Show.S01", "e1.mkv")
	libFile := filepath.Join(libDir, "e1.mkv")
	require.NoError(t, os.WriteFile(dlFile, []byte("episode-data"), 0o600))
	require.NoError(t, os.Link(dlFile, libFile))

	var deletedFiles []string
	arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body any
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v3/series":
			body = []map[string]any{{"id": 7, "title": "Example Show", "year": 2020, "path": filepath.Join(root, "tv", "Example Show"), "statistics": map[string]any{"episodeFileCount": 1}}}
		case "GET /api/v3/episodefile":
			body = []map[string]any{{"id": 70, "seriesId": 7, "seasonNumber": 1, "path": libFile, "size": 12, "quality": map[string]any{"quality": map[string]any{"name": "WEBDL-1080p"}}}}
		case "GET /api/v3/history":
			body = map[string]any{"totalRecords": 1, "records": []map[string]any{{"downloadId": "ABCD", "seriesId": 7, "episode": map[string]any{"seasonNumber": 1}}}}
		case "GET /api/v3/remotepathmapping":
			body = []map[string]any{{"host": "qbittorrent", "remotePath": "/downloads/", "localPath": downloads + string(filepath.Separator)}}
		case "GET /api/v3/rootfolder", "GET /api/v3/diskspace":
			body = []any{}
		case "DELETE /api/v3/episodefile/70":
			deletedFiles = append(deletedFiles, r.URL.Path)
			body = map[string]any{}
		default:
			http.NotFound(w, r)
			return
		}
		if err := json.NewEncoder(w).Encode(body); err != nil {
			t.Error(err)
		}
	}))
	defer arr.Close()

	torrents := &fakeTorrents{
		torrents: map[int][]qbt.Torrent{1: {
			{Hash: "abcd", Name: "Example.Show.S01", SavePath: "/downloads", ContentPath: "/downloads/Example.Show.S01", Size: 12, Uploaded: 24, Downloaded: 12, Tracker: "https://tracker.example/announce", AddedOn: 1},
			{Hash: "ef01", Name: "Unrelated.Release", SavePath: "/downloads", ContentPath: "/downloads/Unrelated.Release", Size: 3, AddedOn: 2},
		}},
		files: map[string]qbt.TorrentFiles{
			"abcd": {{Name: "Example.Show.S01/e1.mkv", Size: 12, Priority: 1}},
			"ef01": {{Name: "Unrelated.Release/u.bin", Size: 3, Priority: 1}},
		},
		deleted: map[int][]string{},
	}
	svc := NewService(
		&fakeArrStore{instances: []*models.ArrInstance{{ID: 3, Name: "sonarr", Type: models.ArrInstanceTypeSonarr, BaseURL: arr.URL}}},
		&fakeInstances{instances: []*models.Instance{{ID: 1, Name: "qb", IsActive: true}}},
		torrents,
		noBackend{},
	)

	tree, err := svc.Tree(t.Context(), false)
	require.NoError(t, err)
	require.Len(t, tree.Nodes, 2)

	series := tree.Nodes[0]
	require.Equal(t, "sonarr:3:series:7", series.ID)
	require.Len(t, series.Children, 1)
	season := series.Children[0]
	require.Equal(t, "sonarr:3:season:7:1", season.ID)
	require.Equal(t, "WEBDL-1080p", season.Quality)
	require.Len(t, season.Torrents, 1)
	require.Equal(t, "tracker.example", season.Torrents[0].Tracker)
	require.Equal(t, "/downloads/Example.Show.S01", season.Torrents[0].ContentPath)
	require.Equal(t, []string{filepath.Join(downloads, "Example.Show.S01")}, season.DownloadPaths)
	require.Len(t, season.Files, 1)
	require.Equal(t, libFile, season.Files[0].LibraryPath)
	require.Equal(t, dlFile, season.Files[0].DownloadPath)
	require.NotNil(t, season.Files[0].LinkCount)
	require.Equal(t, uint64(2), *season.Files[0].LinkCount)
	require.True(t, season.ReclaimableKnown)
	require.Equal(t, int64(12), season.ReclaimableBytes)
	require.Equal(t, int64(12), series.SizeBytes)
	require.InDelta(t, 2.0, season.Stats.Ratio, 0.001)

	// The unrelated file does not exist on disk, so its torrent is an orphan of unknown size freed.
	orphan := tree.Nodes[1]
	require.Equal(t, "orphan:torrent:1:ef01", orphan.ID)
	require.False(t, orphan.ReclaimableKnown)

	overview, err := svc.Overview(t.Context())
	require.NoError(t, err)
	require.Equal(t, int64(12), overview.Totals.TrackedBytes)
	require.Equal(t, int64(12), overview.Totals.ReclaimableBytes)

	resp, err := svc.Delete(t.Context(), DeleteRequest{NodeIDs: []string{series.ID}, DeleteTorrents: true, DeleteCrossSeeds: true, DeleteArrFiles: true})
	require.NoError(t, err)
	require.Equal(t, int64(12), resp.ReclaimableBytes)
	require.Len(t, resp.Actions, 2)
	for _, a := range resp.Actions {
		require.Equal(t, StatusOK, a.Status, a.Error)
	}
	require.Equal(t, map[int][]string{1: {"abcd"}}, torrents.deleted)
	require.Equal(t, []string{"/api/v3/episodefile/70"}, deletedFiles)
}
