// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

// Package spacemgmt builds the Space Management view: Sonarr/Radarr items with
// the qBittorrent torrents behind them, the space each one frees, and a delete
// that removes torrents and arr files together.
package spacemgmt

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	qbt "github.com/autobrr/go-qbittorrent"
	"golang.org/x/sync/singleflight"

	"github.com/autobrr/qui/internal/fsops"
	localbackend "github.com/autobrr/qui/internal/fsops/local"
	"github.com/autobrr/qui/internal/models"
)

const (
	cacheTTL     = 5 * time.Minute
	buildTimeout = 10 * time.Minute
)

// ErrUnknownNode is returned by Delete for a node ID the tree does not hold.
var ErrUnknownNode = errors.New("unknown node id")

type arrInstanceStore interface {
	ListEnabled(ctx context.Context) ([]*models.ArrInstance, error)
	GetDecryptedAPIKey(instance *models.ArrInstance) (string, error)
	GetDecryptedBasicPassword(instance *models.ArrInstance) (string, error)
}

type instanceLister interface {
	List(ctx context.Context) ([]*models.Instance, error)
}

type torrentSource interface {
	GetAllTorrents(ctx context.Context, instanceID int) ([]qbt.Torrent, error)
	GetTorrentFilesBatch(ctx context.Context, instanceID int, hashes []string) (map[string]qbt.TorrentFiles, error)
	BulkAction(ctx context.Context, instanceID int, hashes []string, action string) error
	GetFreeSpace(ctx context.Context, instanceID int) (int64, error)
}

type backendResolver interface {
	Resolve(ctx context.Context, instanceID int) (fsops.Backend, models.FilesystemMode, error)
}

// Service builds and caches the space tree and runs deletes.
type Service struct {
	arrStore  arrInstanceStore
	instances instanceLister
	torrents  torrentSource
	backends  backendResolver
	// local stats library paths and translated download paths, which are in
	// the view qui shares with the arr apps.
	local fsops.Backend

	mu     sync.Mutex
	cached *snapshot
	builds singleflight.Group
}

// NewService wires the service to qui's stores, sync manager and backend pool.
func NewService(arrStore arrInstanceStore, instances instanceLister, torrents torrentSource, backends backendResolver) *Service {
	return &Service{
		arrStore:  arrStore,
		instances: instances,
		torrents:  torrents,
		backends:  backends,
		local:     localbackend.NewBackend(),
	}
}

// Tree returns the cached tree, rebuilding it when stale or when refresh is set.
func (s *Service) Tree(ctx context.Context, refresh bool) (*Tree, error) {
	snap, err := s.snapshot(ctx, refresh)
	if err != nil {
		return nil, err
	}
	return &Tree{Nodes: snap.nodes, GeneratedAt: snap.generatedAt}, nil
}

// Overview returns mounts and totals from the cached tree.
func (s *Service) Overview(ctx context.Context) (*Overview, error) {
	snap, err := s.snapshot(ctx, false)
	if err != nil {
		return nil, err
	}
	return &Overview{Mounts: snap.mounts, Totals: snap.totals, GeneratedAt: snap.generatedAt}, nil
}

func (s *Service) snapshot(ctx context.Context, refresh bool) (*snapshot, error) {
	s.mu.Lock()
	snap := s.cached
	s.mu.Unlock()
	if !refresh && snap != nil && time.Since(snap.generatedAt) < cacheTTL {
		return snap, nil
	}

	ch := s.builds.DoChan("tree", func() (any, error) {
		// One build serves every waiting request, so a closed browser tab must not cancel it.
		buildCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), buildTimeout)
		defer cancel()
		built, err := s.build(buildCtx)
		if err != nil {
			return nil, err
		}
		s.mu.Lock()
		s.cached = built
		s.mu.Unlock()
		return built, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return nil, fmt.Errorf("build space tree: %w", res.Err)
		}
		return res.Val.(*snapshot), nil
	}
}

func (s *Service) invalidate() {
	s.mu.Lock()
	s.cached = nil
	s.mu.Unlock()
}
