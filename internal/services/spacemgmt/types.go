// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import "time"

const (
	KindSeries        = "series"
	KindSeason        = "season"
	KindMovie         = "movie"
	KindOrphanTorrent = "orphanTorrent"
	KindOrphanFile    = "orphanFile"

	MountKindDownload = "download"
	MountKindLibrary  = "library"

	ActionDeleteTorrent = "deleteTorrent"
	ActionDeleteArrFile = "deleteArrFile"

	StatusPlanned = "planned"
	StatusOK      = "ok"
	StatusError   = "error"
)

// Overview is the response of GET /api/space/overview.
type Overview struct {
	Mounts      []Mount   `json:"mounts"`
	Totals      Totals    `json:"totals"`
	GeneratedAt time.Time `json:"generatedAt"`
}

// Mount is the disk usage of one download or library filesystem.
type Mount struct {
	Path       string `json:"path"`
	Kind       string `json:"kind"`
	TotalBytes int64  `json:"totalBytes"`
	UsedBytes  int64  `json:"usedBytes"`
	FreeBytes  int64  `json:"freeBytes"`
}

// Totals sums the top-level nodes of the tree.
type Totals struct {
	TrackedBytes       int64 `json:"trackedBytes"`
	ReclaimableBytes   int64 `json:"reclaimableBytes"`
	OrphanTorrentBytes int64 `json:"orphanTorrentBytes"`
	OrphanFileBytes    int64 `json:"orphanFileBytes"`
}

// Tree is the response of GET /api/space/tree.
type Tree struct {
	Nodes       []*Node   `json:"nodes"`
	GeneratedAt time.Time `json:"generatedAt"`
}

// Node is one series, season, movie, or orphan in the tree.
type Node struct {
	ID               string    `json:"id"`
	Kind             string    `json:"kind"`
	Title            string    `json:"title"`
	Year             int       `json:"year,omitempty"`
	ArrInstanceID    int       `json:"arrInstanceId,omitempty"`
	ArrInstanceName  string    `json:"arrInstanceName,omitempty"`
	ArrType          string    `json:"arrType,omitempty"`
	Quality          string    `json:"quality,omitempty"`
	AddedAt          string    `json:"addedAt,omitempty"`
	SizeBytes        int64     `json:"sizeBytes"`
	ReclaimableBytes int64     `json:"reclaimableBytes"`
	ReclaimableKnown bool      `json:"reclaimableKnown"`
	LibraryPaths     []string  `json:"libraryPaths"`
	DownloadPaths    []string  `json:"downloadPaths"`
	Files            []File    `json:"files"`
	Torrents         []Torrent `json:"torrents"`
	Stats            Stats     `json:"stats"`
	Children         []*Node   `json:"children,omitempty"`

	plan nodePlan
}

// File is one physical file of a node; a library file and the torrent file it
// is hardlinked to share one entry.
type File struct {
	LibraryPath  string  `json:"libraryPath,omitempty"`
	DownloadPath string  `json:"downloadPath,omitempty"`
	SizeBytes    int64   `json:"sizeBytes"`
	LinkCount    *uint64 `json:"linkCount"`
	Hardlinked   bool    `json:"hardlinked"`
}

// Torrent is one qBittorrent torrent behind a node.
type Torrent struct {
	InstanceID         int     `json:"instanceId"`
	InstanceName       string  `json:"instanceName"`
	Hash               string  `json:"hash"`
	Name               string  `json:"name"`
	Tracker            string  `json:"tracker"`
	SavePath           string  `json:"savePath"`
	ContentPath        string  `json:"contentPath"`
	SizeBytes          int64   `json:"sizeBytes"`
	Uploaded           int64   `json:"uploaded"`
	Downloaded         int64   `json:"downloaded"`
	Ratio              float64 `json:"ratio"`
	SeedingTimeSeconds int64   `json:"seedingTimeSeconds"`
	LastActivity       string  `json:"lastActivity,omitempty"`
	AddedOn            string  `json:"addedOn,omitempty"`
	State              string  `json:"state"`
	IsCrossSeed        bool    `json:"isCrossSeed"`
	CrossSeedOf        string  `json:"crossSeedOf,omitempty"`
}

// Stats rolls up the torrents of a node.
type Stats struct {
	Uploaded           int64   `json:"uploaded"`
	Downloaded         int64   `json:"downloaded"`
	Ratio              float64 `json:"ratio"`
	SeedingTimeSeconds int64   `json:"seedingTimeSeconds"`
	LastActivity       *string `json:"lastActivity"`
}

// DeleteRequest is the body of POST /api/space/delete.
type DeleteRequest struct {
	NodeIDs          []string `json:"nodeIds"`
	DeleteTorrents   bool     `json:"deleteTorrents"`
	DeleteCrossSeeds bool     `json:"deleteCrossSeeds"`
	DeleteArrFiles   bool     `json:"deleteArrFiles"`
	DryRun           bool     `json:"dryRun"`
}

// DeleteResponse is the plan, or the outcome, of a delete.
type DeleteResponse struct {
	ReclaimableBytes int64          `json:"reclaimableBytes"`
	Actions          []DeleteAction `json:"actions"`
}

// DeleteAction is one torrent or arr file delete.
type DeleteAction struct {
	NodeID string `json:"nodeId"`
	Type   string `json:"type"`
	Target string `json:"target"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}
