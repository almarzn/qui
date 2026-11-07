// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	qbt "github.com/autobrr/go-qbittorrent"
	"github.com/rs/zerolog/log"
	"golang.org/x/sync/errgroup"

	"github.com/autobrr/qui/internal/fsops"
	"github.com/autobrr/qui/internal/models"
)

// episodeFileConcurrency bounds the per-series episodefile requests to one Sonarr.
const episodeFileConcurrency = 4

type snapshot struct {
	generatedAt time.Time
	nodes       []*Node
	byID        map[string]*Node
	mounts      []Mount
	totals      Totals
	torrents    map[torrentKey]*torrentEntry
}

// arrFile is one Sonarr episode file or Radarr movie file.
type arrFile struct {
	arrInstanceID   int
	arrInstanceName string
	arrType         models.ArrInstanceType
	fileID          int
	itemID          string
	itemTitle       string
	quality         string
	added           time.Time
	ref             fileRef
}

type plannedTorrent struct {
	key         torrentKey
	isCrossSeed bool
}

// nodePlan is what a delete of the node removes.
type nodePlan struct {
	torrents []plannedTorrent
	arrFiles []*arrFile
}

type arrSource struct {
	instance     *models.ArrInstance
	series       []sonarrSeries
	episodeFiles map[int][]sonarrEpisodeFile
	movies       []radarrMovie
	history      []arrHistoryRecord
	mappings     []arrRemotePathMapping
	mounts       []Mount
	err          error
}

type qbitSource struct {
	instance *models.Instance
	backend  fsops.Backend
	torrents []qbt.Torrent
	files    map[string]qbt.TorrentFiles
	err      error
}

func (s *Service) build(ctx context.Context) (*snapshot, error) {
	start := time.Now()
	arrInstances, err := s.arrStore.ListEnabled(ctx)
	if err != nil {
		return nil, fmt.Errorf("list arr instances: %w", err)
	}
	snap := &snapshot{
		generatedAt: time.Now().UTC(),
		nodes:       []*Node{},
		byID:        make(map[string]*Node),
		mounts:      []Mount{},
		torrents:    make(map[torrentKey]*torrentEntry),
	}
	if len(arrInstances) == 0 {
		return snap, nil
	}

	arrs := s.fetchArrs(ctx, arrInstances)
	qbits, err := s.fetchQbits(ctx)
	if err != nil {
		return nil, err
	}
	// A source that failed hides what it would have claimed, so orphans are
	// only reported when every source answered.
	partial := false
	for _, a := range arrs {
		if a.err != nil {
			partial = true
			log.Warn().Err(a.err).Int("arrInstanceID", a.instance.ID).Str("arrInstance", a.instance.Name).Msg("space management: arr instance unavailable")
		}
	}
	for _, q := range qbits {
		if q.err != nil {
			partial = true
			log.Warn().Err(q.err).Int("instanceID", q.instance.ID).Msg("space management: qBittorrent instance unavailable")
		}
	}

	library := collectArrFiles(arrs)
	refs := make([]*fileRef, len(library))
	for i, f := range library {
		refs[i] = &f.ref
	}
	statRefs(ctx, s.local, nil, refs)

	entries := s.collectTorrents(ctx, qbits, arrs)
	for _, e := range entries {
		snap.torrents[e.key()] = e
	}

	historyByHash, historySeasons := historyLinks(arrs)
	libraryItemsByKey := make(map[fsops.FileKey][]string)
	for _, f := range library {
		if f.ref.hasKey {
			libraryItemsByKey[f.ref.key] = appendUnique(libraryItemsByKey[f.ref.key], f.itemID)
		}
	}
	links := linkTorrents(entries, historyByHash, libraryItemsByKey)

	b := &nodeBuilder{snap: snap, entries: entries}
	b.addArrNodes(arrs, library, links, historySeasons)
	if !partial {
		b.addOrphanTorrents(links.orphans)
		b.addOrphanFiles(library, entries)
	}
	snap.mounts = s.collectMounts(ctx, arrs, qbits)

	log.Debug().
		Int("nodes", len(snap.nodes)).
		Int("torrents", len(entries)).
		Int("libraryFiles", len(library)).
		Bool("partial", partial).
		Dur("elapsed", time.Since(start)).
		Msg("space management: tree built")
	return snap, nil
}

func (s *Service) arrClientFor(instance *models.ArrInstance) (*arrClient, error) {
	apiKey, err := s.arrStore.GetDecryptedAPIKey(instance)
	if err != nil {
		return nil, fmt.Errorf("decrypt api key: %w", err)
	}
	basicPass, err := s.arrStore.GetDecryptedBasicPassword(instance)
	if err != nil {
		return nil, fmt.Errorf("decrypt basic auth password: %w", err)
	}
	return newArrClient(instance, apiKey, basicPass), nil
}

func (s *Service) fetchArrs(ctx context.Context, instances []*models.ArrInstance) []*arrSource {
	out := make([]*arrSource, len(instances))
	var wg sync.WaitGroup
	for i, inst := range instances {
		out[i] = &arrSource{instance: inst}
		wg.Go(func() { s.fetchArr(ctx, out[i]) })
	}
	wg.Wait()
	return out
}

func (s *Service) fetchArr(ctx context.Context, src *arrSource) {
	client, err := s.arrClientFor(src.instance)
	if err != nil {
		src.err = err
		return
	}
	switch src.instance.Type {
	case models.ArrInstanceTypeSonarr:
		src.err = fetchSonarrLibrary(ctx, client, src)
	case models.ArrInstanceTypeRadarr:
		src.movies, src.err = client.movies(ctx)
	}
	if src.err != nil {
		return
	}
	if src.history, err = client.importHistory(ctx); err != nil {
		src.err = fmt.Errorf("history: %w", err)
		return
	}
	if src.mappings, err = client.remotePathMappings(ctx); err != nil {
		log.Debug().Err(err).Int("arrInstanceID", src.instance.ID).Msg("space management: remote path mappings unavailable")
	}
	src.mounts = libraryMounts(ctx, client)
}

func fetchSonarrLibrary(ctx context.Context, client *arrClient, src *arrSource) error {
	series, err := client.series(ctx)
	if err != nil {
		return err
	}
	src.series = series
	src.episodeFiles = make(map[int][]sonarrEpisodeFile, len(series))
	var mu sync.Mutex
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(episodeFileConcurrency)
	for _, sr := range series {
		if sr.Statistics.EpisodeFileCount == 0 {
			continue
		}
		g.Go(func() error {
			files, err := client.episodeFiles(gctx, sr.ID)
			if err != nil {
				return fmt.Errorf("episode files of series %d: %w", sr.ID, err)
			}
			mu.Lock()
			src.episodeFiles[sr.ID] = files
			mu.Unlock()
			return nil
		})
	}
	return g.Wait()
}

func libraryMounts(ctx context.Context, client *arrClient) []Mount {
	roots, err := client.rootFolders(ctx)
	if err != nil {
		log.Debug().Err(err).Int("arrInstanceID", client.instance.ID).Msg("space management: root folders unavailable")
		return nil
	}
	disks, err := client.diskSpace(ctx)
	if err != nil {
		log.Debug().Err(err).Int("arrInstanceID", client.instance.ID).Msg("space management: disk space unavailable")
		return nil
	}
	var mounts []Mount
	for _, root := range roots {
		best := -1
		bestLen := -1
		rootSlash := toSlash(root.Path)
		for i, d := range disks {
			prefix := strings.TrimRight(toSlash(d.Path), "/")
			if hasPathPrefix(rootSlash, prefix, windowsStyle(d.Path)) && len(prefix) > bestLen {
				best, bestLen = i, len(prefix)
			}
		}
		if best < 0 || disks[best].TotalSpace <= 0 {
			continue
		}
		d := disks[best]
		mounts = append(mounts, Mount{
			Path:       root.Path,
			Kind:       MountKindLibrary,
			TotalBytes: d.TotalSpace,
			FreeBytes:  d.FreeSpace,
			UsedBytes:  max(d.TotalSpace-d.FreeSpace, 0),
		})
	}
	return mounts
}

func (s *Service) fetchQbits(ctx context.Context) ([]*qbitSource, error) {
	instances, err := s.instances.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("list qBittorrent instances: %w", err)
	}
	var out []*qbitSource
	for _, inst := range instances {
		if inst.IsActive {
			out = append(out, &qbitSource{instance: inst})
		}
	}
	var wg sync.WaitGroup
	for _, src := range out {
		wg.Go(func() { s.fetchQbit(ctx, src) })
	}
	wg.Wait()
	return out, nil
}

func (s *Service) fetchQbit(ctx context.Context, src *qbitSource) {
	if backend, _, err := s.backends.Resolve(ctx, src.instance.ID); err == nil {
		src.backend = backend
	}
	torrents, err := s.torrents.GetAllTorrents(ctx, src.instance.ID)
	if err != nil {
		src.err = err
		return
	}
	hashes := make([]string, len(torrents))
	for i, t := range torrents {
		hashes[i] = t.Hash
	}
	files, err := s.torrents.GetTorrentFilesBatch(ctx, src.instance.ID, hashes)
	if err != nil {
		src.err = fmt.Errorf("torrent files: %w", err)
		return
	}
	src.torrents = torrents
	src.files = files
}

func collectArrFiles(arrs []*arrSource) []*arrFile {
	var out []*arrFile
	for _, a := range arrs {
		if a.err != nil {
			continue
		}
		inst := a.instance
		for _, sr := range a.series {
			for _, ef := range a.episodeFiles[sr.ID] {
				out = append(out, &arrFile{
					arrInstanceID:   inst.ID,
					arrInstanceName: inst.Name,
					arrType:         inst.Type,
					fileID:          ef.ID,
					itemID:          seasonID(inst.ID, sr.ID, ef.SeasonNumber),
					itemTitle:       fmt.Sprintf("%s - Season %d", sr.Title, ef.SeasonNumber),
					quality:         ef.Quality.Quality.Name,
					added:           ef.DateAdded,
					ref:             fileRef{path: ef.Path, size: ef.Size},
				})
			}
		}
		for _, m := range a.movies {
			if !m.HasFile || m.MovieFile == nil {
				continue
			}
			out = append(out, &arrFile{
				arrInstanceID:   inst.ID,
				arrInstanceName: inst.Name,
				arrType:         inst.Type,
				fileID:          m.MovieFile.ID,
				itemID:          movieID(inst.ID, m.ID),
				itemTitle:       m.Title,
				quality:         m.MovieFile.Quality.Quality.Name,
				added:           m.MovieFile.DateAdded,
				ref:             fileRef{path: m.MovieFile.Path, size: m.MovieFile.Size},
			})
		}
	}
	return out
}

func seriesID(arrInstanceID, id int) string {
	return fmt.Sprintf("sonarr:%d:series:%d", arrInstanceID, id)
}

func seasonID(arrInstanceID, seriesID, season int) string {
	return fmt.Sprintf("sonarr:%d:season:%d:%d", arrInstanceID, seriesID, season)
}

func movieID(arrInstanceID, id int) string {
	return fmt.Sprintf("radarr:%d:movie:%d", arrInstanceID, id)
}

// historyLinks maps each imported downloadId to the items it imported into,
// and lists the seasons each Sonarr series has imports for.
func historyLinks(arrs []*arrSource) (map[string][]string, map[string][]int) {
	byHash := make(map[string][]string)
	seasons := make(map[string][]int)
	for _, a := range arrs {
		if a.err != nil {
			continue
		}
		knownSeries := make(map[int]struct{}, len(a.series))
		for _, sr := range a.series {
			knownSeries[sr.ID] = struct{}{}
		}
		knownMovies := make(map[int]struct{}, len(a.movies))
		for _, m := range a.movies {
			knownMovies[m.ID] = struct{}{}
		}
		for _, rec := range a.history {
			if rec.DownloadID == "" {
				continue
			}
			hash := strings.ToUpper(rec.DownloadID)
			switch a.instance.Type {
			case models.ArrInstanceTypeSonarr:
				if _, ok := knownSeries[rec.SeriesID]; !ok || rec.Episode == nil {
					continue
				}
				byHash[hash] = appendUnique(byHash[hash], seasonID(a.instance.ID, rec.SeriesID, rec.Episode.SeasonNumber))
				sk := seriesID(a.instance.ID, rec.SeriesID)
				if !slices.Contains(seasons[sk], rec.Episode.SeasonNumber) {
					seasons[sk] = append(seasons[sk], rec.Episode.SeasonNumber)
				}
			case models.ArrInstanceTypeRadarr:
				if _, ok := knownMovies[rec.MovieID]; !ok {
					continue
				}
				byHash[hash] = appendUnique(byHash[hash], movieID(a.instance.ID, rec.MovieID))
			}
		}
	}
	return byHash, seasons
}

// statRefs fills identity and size for refs from backend. scope binds remote
// identities to their host; nil is the qui host.
func statRefs(ctx context.Context, backend fsops.Backend, scope *models.Instance, refs []*fileRef) {
	if backend == nil || len(refs) == 0 {
		return
	}
	d := backend.Paths()
	var paths []string
	var targets []*fileRef
	for _, r := range refs {
		p := d.FromSlash(r.path)
		if !d.IsAbs(p) {
			continue
		}
		paths = append(paths, p)
		targets = append(targets, r)
	}
	infos, errs := fsops.StatAll(ctx, backend, paths)
	for i, r := range targets {
		info := infos[i]
		if errs[i] != nil || info == nil || !info.Mode.IsRegular() {
			continue
		}
		r.size = info.Size
		if info.FileIDErr != nil {
			continue
		}
		if key, ok := fsops.FileKeyOf(info.FileID, scope); ok {
			r.key, r.hasKey, r.nlink = key, true, max(info.Nlinks, 1)
		}
	}
}

type torrentFileStat struct {
	entry *torrentEntry
	index int
	raw   string
}

// collectTorrents reads every torrent's files off disk. A qBittorrent path is
// first translated by the arr remote path mappings and read from qui's own
// view; otherwise it is read through the instance backend as qBittorrent
// reports it, and a path that fails there gets one more try through prefixes
// inferred from arr import history.
func (s *Service) collectTorrents(ctx context.Context, qbits []*qbitSource, arrs []*arrSource) []*torrentEntry {
	mappings := explicitMappings(arrs)
	var entries []*torrentEntry
	var localRefs []*fileRef
	var untranslated []torrentFileStat
	for _, q := range qbits {
		if q.err != nil {
			continue
		}
		var instanceRefs []*fileRef
		for _, t := range q.torrents {
			e := newTorrentEntry(q, t, mappings)
			for i := range e.files {
				ref := &e.files[i]
				raw, ok := joinTorrentPath(t.SavePath, ref.path)
				if !ok {
					continue
				}
				if translated, ok := translatePath(raw, mappings); ok {
					ref.path = translated
					localRefs = append(localRefs, ref)
					continue
				}
				ref.path = raw
				instanceRefs = append(instanceRefs, ref)
				untranslated = append(untranslated, torrentFileStat{entry: e, index: i, raw: raw})
			}
			entries = append(entries, e)
		}
		statRefs(ctx, q.backend, q.instance, instanceRefs)
	}
	statRefs(ctx, s.local, nil, localRefs)
	s.retryInferred(ctx, arrs, entries, untranslated)
	return entries
}

// newTorrentEntry lists the wanted files of t by name; collectTorrents turns
// the names into paths.
func newTorrentEntry(q *qbitSource, t qbt.Torrent, mappings []pathMapping) *torrentEntry {
	e := &torrentEntry{instanceID: q.instance.ID, instanceName: q.instance.Name, torrent: t, contentPath: t.ContentPath}
	if translated, ok := translatePath(t.ContentPath, mappings); ok {
		e.contentPath = translated
	}
	files, ok := q.files[t.Hash]
	if !ok {
		files = q.files[strings.ToLower(t.Hash)]
	}
	for _, f := range files {
		if f.Priority != 0 {
			e.files = append(e.files, fileRef{path: f.Name, size: f.Size})
		}
	}
	return e
}

// retryInferred reads the untranslated files that failed through the
// prefixes inferred from import history.
func (s *Service) retryInferred(ctx context.Context, arrs []*arrSource, entries []*torrentEntry, untranslated []torrentFileStat) {
	var missing []torrentFileStat
	for _, u := range untranslated {
		if !u.entry.files[u.index].hasKey {
			missing = append(missing, u)
		}
	}
	if len(missing) == 0 {
		return
	}
	inferred := inferMappings(historyPathPairs(arrs, entries))
	if len(inferred) == 0 {
		return
	}
	var retry []*fileRef
	for _, m := range missing {
		translated, ok := translatePath(m.raw, inferred)
		if !ok {
			continue
		}
		ref := &m.entry.files[m.index]
		ref.path = translated
		retry = append(retry, ref)
		if cp, ok := translatePath(m.entry.torrent.ContentPath, inferred); ok {
			m.entry.contentPath = cp
		}
	}
	statRefs(ctx, s.local, nil, retry)
}

func explicitMappings(arrs []*arrSource) []pathMapping {
	var out []pathMapping
	for _, a := range arrs {
		for _, m := range a.mappings {
			pm := pathMapping{remote: m.RemotePath, local: m.LocalPath}
			if !slices.Contains(out, pm) {
				out = append(out, pm)
			}
		}
	}
	return out
}

// historyPathPairs pairs each imported file's droppedPath (the arr view of
// the download) with the qBittorrent path of the same file name in the
// torrent that the import names.
func historyPathPairs(arrs []*arrSource, entries []*torrentEntry) []pathMapping {
	byHash := make(map[string]*torrentEntry, len(entries))
	for _, e := range entries {
		for _, h := range e.hashVariants() {
			byHash[h] = e
		}
	}
	var pairs []pathMapping
	for _, a := range arrs {
		for _, rec := range a.history {
			e := byHash[strings.ToUpper(rec.DownloadID)]
			if e == nil || rec.Data.DroppedPath == "" {
				continue
			}
			base := baseOf(rec.Data.DroppedPath)
			for _, f := range e.files {
				if baseOf(f.path) != base {
					continue
				}
				raw, ok := rawPathOf(e, f)
				if !ok {
					break
				}
				if remote, local, ok := commonSuffixPrefixes(raw, rec.Data.DroppedPath); ok {
					pairs = append(pairs, pathMapping{remote: remote, local: local})
				}
				break
			}
		}
	}
	return pairs
}

// rawPathOf rebuilds the qBittorrent path of a torrent file from its save path
// and its name relative to the content.
func rawPathOf(e *torrentEntry, f fileRef) (string, bool) {
	save := toSlash(e.torrent.SavePath)
	p := toSlash(f.path)
	if hasPathPrefix(p, strings.TrimRight(save, "/"), windowsStyle(e.torrent.SavePath)) {
		return f.path, true
	}
	return "", false
}

func baseOf(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

func (s *Service) collectMounts(ctx context.Context, arrs []*arrSource, qbits []*qbitSource) []Mount {
	mounts := []Mount{}
	seen := make(map[string]struct{})
	add := func(m Mount) {
		k := m.Kind + "\x00" + m.Path
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		mounts = append(mounts, m)
	}
	mappings := explicitMappings(arrs)
	for _, q := range qbits {
		for _, m := range s.downloadMounts(ctx, q, mappings) {
			add(m)
		}
	}
	for _, a := range arrs {
		for _, m := range a.mounts {
			add(m)
		}
	}
	return mounts
}

// maxSavePathsPerInstance bounds the statfs calls for one instance.
const maxSavePathsPerInstance = 32

// downloadMounts reports one mount per filesystem among an instance's save
// paths. Two save paths whose statfs answers match are taken as one
// filesystem, and the shorter path names it.
func (s *Service) downloadMounts(ctx context.Context, q *qbitSource, mappings []pathMapping) []Mount {
	if q.err != nil || len(q.torrents) == 0 {
		return nil
	}
	var savePaths []string
	for _, t := range q.torrents {
		if t.SavePath != "" && !slices.Contains(savePaths, t.SavePath) {
			savePaths = append(savePaths, t.SavePath)
		}
	}
	slices.SortFunc(savePaths, func(a, b string) int {
		if c := len(a) - len(b); c != 0 {
			return c
		}
		return strings.Compare(a, b)
	})
	if len(savePaths) > maxSavePathsPerInstance {
		savePaths = savePaths[:maxSavePathsPerInstance]
	}

	type fsKey struct{ total, free int64 }
	found := make(map[fsKey]struct{})
	var out []Mount
	for _, sp := range savePaths {
		backend, p := q.backend, sp
		if translated, ok := translatePath(sp, mappings); ok {
			backend, p = s.local, translated
		}
		if backend == nil {
			continue
		}
		p = backend.Paths().FromSlash(p)
		if !backend.Paths().IsAbs(p) {
			continue
		}
		res, err := backend.Statfs(ctx, p)
		if err != nil || res.BytesTotal <= 0 {
			continue
		}
		k := fsKey{total: res.BytesTotal, free: res.BytesAvailable}
		if _, ok := found[k]; ok {
			continue
		}
		found[k] = struct{}{}
		out = append(out, Mount{
			Path:       p,
			Kind:       MountKindDownload,
			TotalBytes: res.BytesTotal,
			FreeBytes:  res.BytesAvailable,
			UsedBytes:  max(res.BytesTotal-res.BytesAvailable, 0),
		})
	}
	if len(out) > 0 {
		return out
	}
	// qui cannot read this instance's disk: report what qBittorrent knows,
	// which is free space without a total.
	free, err := s.torrents.GetFreeSpace(ctx, q.instance.ID)
	if err != nil {
		return nil
	}
	return []Mount{{Path: savePaths[0], Kind: MountKindDownload, FreeBytes: free}}
}
