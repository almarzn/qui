// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"path"
	"slices"
	"strings"
)

// Paths here come from foreign systems (qBittorrent, Sonarr, Radarr) whose
// host OS qui does not know, so these helpers work on strings that may use
// either separator rather than on one fsops dialect.

// pathMapping translates a qBittorrent path prefix (remote) to the view that
// the arr apps and qui share (local), like an arr remote path mapping.
type pathMapping struct {
	remote string
	local  string
}

func toSlash(p string) string { return strings.ReplaceAll(p, `\`, "/") }

func windowsStyle(p string) bool {
	return strings.Contains(p, `\`) || hasDrivePrefix(p)
}

func hasDrivePrefix(p string) bool {
	return len(p) >= 2 && p[1] == ':' &&
		(('a' <= p[0] && p[0] <= 'z') || ('A' <= p[0] && p[0] <= 'Z'))
}

// separatorOf returns the separator a path uses, slash unless it only uses backslashes.
func separatorOf(p string) string {
	if strings.Contains(p, `\`) && !strings.Contains(p, "/") {
		return `\`
	}
	return "/"
}

// translatePath applies the longest mapping whose remote prefix contains p on
// a path-component boundary. Windows-style prefixes compare case-insensitively.
func translatePath(p string, mappings []pathMapping) (string, bool) {
	sp := toSlash(p)
	best := -1
	bestLen := -1
	for i, m := range mappings {
		remote := strings.TrimRight(toSlash(m.remote), "/")
		if strings.TrimSpace(m.remote) == "" || strings.TrimSpace(m.local) == "" {
			continue
		}
		if !hasPathPrefix(sp, remote, windowsStyle(m.remote) || windowsStyle(p)) {
			continue
		}
		if len(remote) > bestLen {
			best, bestLen = i, len(remote)
		}
	}
	if best < 0 {
		return "", false
	}
	rest := sp[bestLen:]
	local := mappings[best].local
	sep := separatorOf(local)
	base := strings.TrimRight(local, `/\`)
	out := base + strings.ReplaceAll(rest, "/", sep)
	if out == "" {
		out = sep
	}
	return out, true
}

// hasPathPrefix reports whether p (slash form) lies at or under prefix (slash
// form, no trailing slash; "" is the root "/").
func hasPathPrefix(p, prefix string, fold bool) bool {
	if len(p) < len(prefix) {
		return false
	}
	head := p[:len(prefix)]
	if fold {
		if !strings.EqualFold(head, prefix) {
			return false
		}
	} else if head != prefix {
		return false
	}
	return len(p) == len(prefix) || p[len(prefix)] == '/'
}

// joinTorrentPath joins a qBittorrent save path and a slash-delimited torrent
// file name in the save path's own separator style. It rejects names that
// escape the save path, POSIX or Windows style.
func joinTorrentPath(savePath, name string) (string, bool) {
	if savePath == "" || name == "" || strings.Contains(name, `\`) ||
		strings.HasPrefix(name, "/") || hasDrivePrefix(name) {
		return "", false
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", false
	}
	sep := separatorOf(savePath)
	return strings.TrimRight(savePath, `/\`) + sep + strings.ReplaceAll(cleaned, "/", sep), true
}

// dirOf returns the parent directory of p in either separator style.
func dirOf(p string) string {
	i := strings.LastIndexAny(p, `/\`)
	switch {
	case i < 0:
		return ""
	case i == 0:
		return p[:1]
	default:
		return p[:i]
	}
}

// commonSuffixPrefixes strips the longest shared trailing path components of
// a qBittorrent file path and the arr view of the same file, returning the two
// prefixes that differ. ok is false when nothing, or everything, is shared.
func commonSuffixPrefixes(remoteFile, localFile string) (remotePrefix, localPrefix string, ok bool) {
	r := strings.Split(toSlash(remoteFile), "/")
	l := strings.Split(toSlash(localFile), "/")
	n := 0
	for n < len(r)-1 && n < len(l)-1 && r[len(r)-1-n] == l[len(l)-1-n] && r[len(r)-1-n] != "" {
		n++
	}
	if n == 0 {
		return "", "", false
	}
	remotePrefix = joinPrefix(r[:len(r)-n])
	localPrefix = joinPrefix(l[:len(l)-n])
	if remotePrefix == localPrefix {
		return "", "", false
	}
	return remotePrefix, localPrefix, true
}

func joinPrefix(parts []string) string {
	joined := strings.Join(parts, "/")
	if joined == "" {
		return "/"
	}
	return joined
}

// inferMappings keeps each remote prefix that every observed pair maps to the
// same local prefix. A remote prefix seen with two local prefixes is ambiguous
// and dropped.
func inferMappings(pairs []pathMapping) []pathMapping {
	locals := make(map[string]map[string]struct{})
	for _, p := range pairs {
		if locals[p.remote] == nil {
			locals[p.remote] = make(map[string]struct{})
		}
		locals[p.remote][p.local] = struct{}{}
	}
	var out []pathMapping
	for remote, set := range locals {
		if len(set) != 1 {
			continue
		}
		for local := range set {
			out = append(out, pathMapping{remote: remote, local: local})
		}
	}
	slices.SortFunc(out, func(a, b pathMapping) int { return strings.Compare(a.remote, b.remote) })
	return out
}
