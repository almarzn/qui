// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/autobrr/qui/internal/buildinfo"
	"github.com/autobrr/qui/internal/models"
	"github.com/autobrr/qui/pkg/httphelpers"
)

const (
	arrDefaultTimeout = 30 * time.Second
	historyPageSize   = 1000
	// historyMaxPages bounds the history walk; older imports beyond it fall back
	// to the inode match.
	historyMaxPages = 50
	// historyEventDownloadFolderImported is the same value in Sonarr and Radarr.
	historyEventDownloadFolderImported = 3
)

// arrClient covers the Sonarr/Radarr v3 endpoints that space management needs
// and internal/services/arr does not expose.
type arrClient struct {
	instance  *models.ArrInstance
	baseURL   string
	apiKey    string
	basicUser string
	basicPass string
	http      *http.Client
}

func newArrClient(instance *models.ArrInstance, apiKey, basicPass string) *arrClient {
	timeout := arrDefaultTimeout
	if instance.TimeoutSeconds > 0 {
		timeout = max(timeout, time.Duration(instance.TimeoutSeconds)*time.Second)
	}
	user := ""
	if instance.BasicUsername != nil {
		user = strings.TrimSpace(*instance.BasicUsername)
	}
	return &arrClient{
		instance:  instance,
		baseURL:   strings.TrimRight(instance.BaseURL, "/"),
		apiKey:    apiKey,
		basicUser: user,
		basicPass: basicPass,
		http:      &http.Client{Timeout: timeout},
	}
}

type arrQuality struct {
	Quality struct {
		Name string `json:"name"`
	} `json:"quality"`
}

type sonarrSeries struct {
	ID         int       `json:"id"`
	Title      string    `json:"title"`
	Year       int       `json:"year"`
	Path       string    `json:"path"`
	Added      time.Time `json:"added"`
	Statistics struct {
		EpisodeFileCount int `json:"episodeFileCount"`
	} `json:"statistics"`
}

type sonarrEpisodeFile struct {
	ID           int        `json:"id"`
	SeriesID     int        `json:"seriesId"`
	SeasonNumber int        `json:"seasonNumber"`
	Path         string     `json:"path"`
	Size         int64      `json:"size"`
	DateAdded    time.Time  `json:"dateAdded"`
	Quality      arrQuality `json:"quality"`
}

type radarrMovieFile struct {
	ID        int        `json:"id"`
	Path      string     `json:"path"`
	Size      int64      `json:"size"`
	DateAdded time.Time  `json:"dateAdded"`
	Quality   arrQuality `json:"quality"`
}

type radarrMovie struct {
	ID        int              `json:"id"`
	Title     string           `json:"title"`
	Year      int              `json:"year"`
	Path      string           `json:"path"`
	Added     time.Time        `json:"added"`
	HasFile   bool             `json:"hasFile"`
	MovieFile *radarrMovieFile `json:"movieFile"`
}

type arrHistoryRecord struct {
	DownloadID string `json:"downloadId"`
	SeriesID   int    `json:"seriesId"`
	MovieID    int    `json:"movieId"`
	Episode    *struct {
		SeasonNumber int `json:"seasonNumber"`
	} `json:"episode"`
	Data struct {
		DroppedPath string `json:"droppedPath"`
	} `json:"data"`
}

type arrHistoryPage struct {
	TotalRecords int                `json:"totalRecords"`
	Records      []arrHistoryRecord `json:"records"`
}

type arrRemotePathMapping struct {
	Host       string `json:"host"`
	RemotePath string `json:"remotePath"`
	LocalPath  string `json:"localPath"`
}

type arrRootFolder struct {
	Path string `json:"path"`
}

type arrDiskSpace struct {
	Path       string `json:"path"`
	FreeSpace  int64  `json:"freeSpace"`
	TotalSpace int64  `json:"totalSpace"`
}

func (c *arrClient) series(ctx context.Context) ([]sonarrSeries, error) {
	var out []sonarrSeries
	return out, c.getJSON(ctx, "/api/v3/series", nil, &out)
}

func (c *arrClient) episodeFiles(ctx context.Context, seriesID int) ([]sonarrEpisodeFile, error) {
	var out []sonarrEpisodeFile
	params := url.Values{"seriesId": {strconv.Itoa(seriesID)}}
	return out, c.getJSON(ctx, "/api/v3/episodefile", params, &out)
}

func (c *arrClient) movies(ctx context.Context) ([]radarrMovie, error) {
	var out []radarrMovie
	return out, c.getJSON(ctx, "/api/v3/movie", nil, &out)
}

func (c *arrClient) remotePathMappings(ctx context.Context) ([]arrRemotePathMapping, error) {
	var out []arrRemotePathMapping
	return out, c.getJSON(ctx, "/api/v3/remotepathmapping", nil, &out)
}

func (c *arrClient) rootFolders(ctx context.Context) ([]arrRootFolder, error) {
	var out []arrRootFolder
	return out, c.getJSON(ctx, "/api/v3/rootfolder", nil, &out)
}

func (c *arrClient) diskSpace(ctx context.Context) ([]arrDiskSpace, error) {
	var out []arrDiskSpace
	return out, c.getJSON(ctx, "/api/v3/diskspace", nil, &out)
}

// importHistory returns the download-folder import records, newest first.
func (c *arrClient) importHistory(ctx context.Context) ([]arrHistoryRecord, error) {
	var records []arrHistoryRecord
	for page := 1; page <= historyMaxPages; page++ {
		params := url.Values{
			"page":           {strconv.Itoa(page)},
			"pageSize":       {strconv.Itoa(historyPageSize)},
			"eventType":      {strconv.Itoa(historyEventDownloadFolderImported)},
			"sortKey":        {"date"},
			"sortDirection":  {"descending"},
			"includeEpisode": {"true"},
		}
		var resp arrHistoryPage
		if err := c.getJSON(ctx, "/api/v3/history", params, &resp); err != nil {
			return nil, err
		}
		records = append(records, resp.Records...)
		if len(resp.Records) < historyPageSize || len(records) >= resp.TotalRecords {
			break
		}
	}
	return records, nil
}

func (c *arrClient) deleteEpisodeFile(ctx context.Context, id int) error {
	return c.delete(ctx, "/api/v3/episodefile/"+strconv.Itoa(id))
}

func (c *arrClient) deleteMovieFile(ctx context.Context, id int) error {
	return c.delete(ctx, "/api/v3/moviefile/"+strconv.Itoa(id))
}

func (c *arrClient) getJSON(ctx context.Context, path string, params url.Values, target any) error {
	endpoint := c.baseURL + path
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	resp, err := c.do(req) //nolint:bodyclose // closed by DrainAndClose
	if err != nil {
		return err
	}
	defer httphelpers.DrainAndClose(resp)
	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

func (c *arrClient) delete(ctx context.Context, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+path, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	resp, err := c.do(req) //nolint:bodyclose // closed by DrainAndClose
	if err != nil {
		return err
	}
	httphelpers.DrainAndClose(resp)
	return nil
}

func (c *arrClient) do(req *http.Request) (*http.Response, error) {
	req.Header.Set("X-Api-Key", c.apiKey)
	req.Header.Set("User-Agent", buildinfo.UserAgent)
	req.Header.Set("Accept", "application/json")
	if c.basicUser != "" {
		req.SetBasicAuth(c.basicUser, c.basicPass)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", req.Method, req.URL.Path, err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		httphelpers.DrainAndClose(resp)
		return nil, errors.New("authentication failed: invalid API key")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		httphelpers.DrainAndClose(resp)
		return nil, fmt.Errorf("%s %s: unexpected status %d: %s", req.Method, req.URL.Path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return resp, nil
}
