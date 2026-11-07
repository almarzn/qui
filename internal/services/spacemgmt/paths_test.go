// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTranslatePath(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		mappings []pathMapping
		want     string
		wantOK   bool
	}{
		{
			name:     "posix prefix with trailing slashes",
			path:     "/downloads/tv/Example.Show.S01/e1.mkv",
			mappings: []pathMapping{{remote: "/downloads/", local: "/media/downloads/"}},
			want:     "/media/downloads/tv/Example.Show.S01/e1.mkv",
			wantOK:   true,
		},
		{
			name:     "exact prefix",
			path:     "/downloads",
			mappings: []pathMapping{{remote: "/downloads", local: "/media/downloads"}},
			want:     "/media/downloads",
			wantOK:   true,
		},
		{
			name:     "prefix must end on a component boundary",
			path:     "/downloads-old/x.mkv",
			mappings: []pathMapping{{remote: "/downloads", local: "/media/downloads"}},
		},
		{
			name: "longest prefix wins",
			path: "/downloads/movies/m.mkv",
			mappings: []pathMapping{
				{remote: "/downloads", local: "/media/downloads"},
				{remote: "/downloads/movies", local: "/mnt/movies"},
			},
			want:   "/mnt/movies/m.mkv",
			wantOK: true,
		},
		{
			name:     "posix remote is case-sensitive",
			path:     "/Downloads/x.mkv",
			mappings: []pathMapping{{remote: "/downloads", local: "/media/downloads"}},
		},
		{
			name:     "windows remote to posix local, case-insensitive",
			path:     `d:\torrents\tv\e1.mkv`,
			mappings: []pathMapping{{remote: `D:\Torrents\`, local: "/media/torrents/"}},
			want:     "/media/torrents/tv/e1.mkv",
			wantOK:   true,
		},
		{
			name:     "posix remote to windows local",
			path:     "/downloads/tv/e1.mkv",
			mappings: []pathMapping{{remote: "/downloads", local: `\\nas\media\downloads\`}},
			want:     `\\nas\media\downloads\tv\e1.mkv`,
			wantOK:   true,
		},
		{
			name:     "root remote",
			path:     "/downloads/x.mkv",
			mappings: []pathMapping{{remote: "/", local: "/media"}},
			want:     "/media/downloads/x.mkv",
			wantOK:   true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := translatePath(tt.path, tt.mappings)
			require.Equal(t, tt.wantOK, ok)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestJoinTorrentPath(t *testing.T) {
	tests := []struct {
		name     string
		savePath string
		file     string
		want     string
		wantOK   bool
	}{
		{"posix", "/downloads/tv/", "Example.Show.S01/e1.mkv", "/downloads/tv/Example.Show.S01/e1.mkv", true},
		{"windows", `D:\Torrents`, "Example.Show.S01/e1.mkv", `D:\Torrents\Example.Show.S01\e1.mkv`, true},
		{"parent traversal", "/downloads", "../etc/passwd", "", false},
		{"nested traversal", "/downloads", "a/../../etc/passwd", "", false},
		{"posix absolute", "/downloads", "/etc/passwd", "", false},
		{"windows drive", "/downloads", "C:/Windows/x", "", false},
		{"backslash", "/downloads", `a\..\..\x`, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := joinTorrentPath(tt.savePath, tt.file)
			require.Equal(t, tt.wantOK, ok)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestInferMappingsFromDroppedPaths(t *testing.T) {
	remote, local, ok := commonSuffixPrefixes("/downloads/tv/Example.Show.S01/e1.mkv", "/media/downloads/tv/Example.Show.S01/e1.mkv")
	require.True(t, ok)
	require.Equal(t, "/", remote)
	require.Equal(t, "/media", local)

	remote, local, ok = commonSuffixPrefixes(`D:\dl\Sample.Movie.2001\m.mkv`, "/media/dl/Sample.Movie.2001/m.mkv")
	require.True(t, ok)
	require.Equal(t, "D:", remote)
	require.Equal(t, "/media", local)

	_, _, ok = commonSuffixPrefixes("/media/dl/m.mkv", "/media/dl/m.mkv")
	require.False(t, ok, "same view needs no mapping")

	got := inferMappings([]pathMapping{
		{remote: "/", local: "/media"},
		{remote: "/", local: "/media"},
		{remote: "/data", local: "/mnt/a"},
		{remote: "/data", local: "/mnt/b"},
	})
	require.Equal(t, []pathMapping{{remote: "/", local: "/media"}}, got)

	translated, ok := translatePath("/downloads/tv/e2.mkv", got)
	require.True(t, ok)
	require.Equal(t, "/media/downloads/tv/e2.mkv", translated)
}
