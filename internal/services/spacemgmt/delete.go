// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/autobrr/qui/internal/models"
)

type torrentAction struct {
	action int // index into the response actions
	key    torrentKey
}

type arrFileAction struct {
	action int
	file   *arrFile
}

type deletePlan struct {
	resp     *DeleteResponse
	torrents []torrentAction
	arrFiles []arrFileAction
}

// Delete plans, and unless req.DryRun runs, the delete of the given nodes.
// Cross-seeds are only deleted together with torrents.
func (s *Service) Delete(ctx context.Context, req DeleteRequest) (*DeleteResponse, error) {
	if len(req.NodeIDs) == 0 {
		return nil, fmt.Errorf("%w: nodeIds is empty", ErrUnknownNode)
	}
	snap, err := s.snapshot(ctx, false)
	if err != nil {
		return nil, err
	}
	plan, err := snap.planDelete(req)
	if err != nil {
		return nil, err
	}
	if req.DryRun {
		return plan.resp, nil
	}
	s.executeTorrentDeletes(ctx, snap, plan)
	s.executeArrDeletes(ctx, plan)
	s.invalidate()
	return plan.resp, nil
}

func (s *snapshot) planDelete(req DeleteRequest) (*deletePlan, error) {
	plan := &deletePlan{resp: &DeleteResponse{Actions: []DeleteAction{}}}
	var unknown []string
	seenTorrents := make(map[torrentKey]struct{})
	type arrFileKey struct {
		instanceID int
		fileID     int
	}
	seenFiles := make(map[arrFileKey]struct{})
	var selectedFiles []*arrFile
	var selectedTorrents []plannedTorrent

	for _, id := range req.NodeIDs {
		node := s.byID[id]
		if node == nil {
			unknown = append(unknown, id)
			continue
		}
		if req.DeleteTorrents {
			for _, pt := range node.plan.torrents {
				if pt.isCrossSeed && !req.DeleteCrossSeeds {
					continue
				}
				if _, ok := seenTorrents[pt.key]; ok {
					continue
				}
				seenTorrents[pt.key] = struct{}{}
				selectedTorrents = append(selectedTorrents, pt)
				plan.torrents = append(plan.torrents, torrentAction{action: len(plan.resp.Actions), key: pt.key})
				plan.resp.Actions = append(plan.resp.Actions, DeleteAction{
					NodeID: id,
					Type:   ActionDeleteTorrent,
					Target: s.torrentTarget(pt.key),
					Status: StatusPlanned,
				})
			}
		}
		if req.DeleteArrFiles {
			for _, f := range node.plan.arrFiles {
				k := arrFileKey{instanceID: f.arrInstanceID, fileID: f.fileID}
				if _, ok := seenFiles[k]; ok {
					continue
				}
				seenFiles[k] = struct{}{}
				selectedFiles = append(selectedFiles, f)
				plan.arrFiles = append(plan.arrFiles, arrFileAction{action: len(plan.resp.Actions), file: f})
				plan.resp.Actions = append(plan.resp.Actions, DeleteAction{
					NodeID: id,
					Type:   ActionDeleteArrFile,
					Target: f.ref.path,
					Status: StatusPlanned,
				})
			}
		}
	}
	if len(unknown) > 0 {
		return nil, fmt.Errorf("%w: %s", ErrUnknownNode, strings.Join(unknown, ", "))
	}
	plan.resp.ReclaimableBytes, _ = reclaimable(s.planRefs(selectedFiles, selectedTorrents))
	return plan, nil
}

func (s *snapshot) torrentTarget(key torrentKey) string {
	if e := s.torrents[key]; e != nil {
		return e.instanceName + ": " + e.torrent.Name
	}
	return key.hash
}

func (s *Service) executeTorrentDeletes(ctx context.Context, snap *snapshot, plan *deletePlan) {
	byInstance := make(map[int][]torrentAction)
	for _, ta := range plan.torrents {
		byInstance[ta.key.instanceID] = append(byInstance[ta.key.instanceID], ta)
	}
	for _, instanceID := range slices.Sorted(maps.Keys(byInstance)) {
		actions := byInstance[instanceID]
		hashes := make([]string, len(actions))
		for i, ta := range actions {
			hashes[i] = ta.key.hash
			if e := snap.torrents[ta.key]; e != nil {
				hashes[i] = e.torrent.Hash
			}
		}
		err := s.torrents.BulkAction(ctx, instanceID, hashes, "deleteWithFiles")
		log.Debug().Err(err).Int("instanceID", instanceID).Int("torrents", len(hashes)).Msg("space management: deleted torrents with files")
		for _, ta := range actions {
			setResult(&plan.resp.Actions[ta.action], err)
		}
	}
}

func (s *Service) executeArrDeletes(ctx context.Context, plan *deletePlan) {
	if len(plan.arrFiles) == 0 {
		return
	}
	instances, err := s.arrStore.ListEnabled(ctx)
	clients := make(map[int]*arrClient)
	for _, inst := range instances {
		if c, cerr := s.arrClientFor(inst); cerr == nil {
			clients[inst.ID] = c
		}
	}
	failed := 0
	for _, fa := range plan.arrFiles {
		f := fa.file
		client := clients[f.arrInstanceID]
		var delErr error
		switch {
		case err != nil:
			delErr = err
		case client == nil:
			delErr = errors.New("arr instance unavailable")
		case f.arrType == models.ArrInstanceTypeSonarr:
			delErr = client.deleteEpisodeFile(ctx, f.fileID)
		default:
			delErr = client.deleteMovieFile(ctx, f.fileID)
		}
		if delErr != nil {
			failed++
		}
		setResult(&plan.resp.Actions[fa.action], delErr)
	}
	log.Debug().Int("files", len(plan.arrFiles)).Int("failed", failed).Msg("space management: deleted arr files")
}

func setResult(a *DeleteAction, err error) {
	if err != nil {
		a.Status = StatusError
		a.Error = err.Error()
		return
	}
	a.Status = StatusOK
}
