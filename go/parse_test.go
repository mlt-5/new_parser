package parse

import (
	"fmt"
	"strings"
	"testing"
)

// The same cases as tests/vocab.test.ts.
func TestLeadingGroup(t *testing.T) {
	for _, c := range []struct{ name, group, site string }{
		{"[SubsPlease] Kyoufu Collector - 03 (1080p) [ABCD1234].mkv", "SubsPlease", ""},
		{"[SubsPlease] Some Show - Part-Two - 03 (1080p) [ABCD1234].mkv", "SubsPlease", ""},
		{"[ToonsHub] HORROR COLLECTOR S01E03 1080p CR WEB-DL AAC2.0 H.264 (Kyoufu Collector, Multi-Subs)", "ToonsHub", ""},
		{"[ZqNotListed] Kyoufu Collector - 03 (1080p) [ABCD1234].mkv", "", "ZqNotListed"},
	} {
		r := Parse(c.name)
		if r.Group != c.group || r.Site != c.site {
			t.Errorf("%q: group %q site %q, want %q %q", c.name, r.Group, r.Site, c.group, c.site)
		}
	}
	r := ParseRls("[SubsPlease] Kyoufu Collector - 03 (1080p) [ABCD1234].mkv")
	if r.Group != "" || r.Site != "SubsPlease" {
		t.Errorf("plain rls: group %q site %q", r.Group, r.Site)
	}
}

func TestVocab(t *testing.T) {
	for _, c := range []struct{ name, got, want string }{
		{"Movie.2020.1080p.FAND.WEB-DL.DDP5.1.H.264-Fight-BB", Parse("Movie.2020.1080p.FAND.WEB-DL.DDP5.1.H.264-Fight-BB").Group, "Fight-BB"},
		{"Movie.2020.1080p.FAND.WEB-DL.DDP5.1.H.264-Fight-BB", Parse("Movie.2020.1080p.FAND.WEB-DL.DDP5.1.H.264-Fight-BB").Collection, "FAND"},
		{"Show.S01E01.1080p.WEB-DL.STEREO.H264-GRP", Parse("Show.S01E01.1080p.WEB-DL.STEREO.H264-GRP").Channels, "2.0"},
	} {
		if c.got != c.want {
			t.Errorf("%q: got %q, want %q", c.name, c.got, c.want)
		}
	}
}

// The double-skip fix in ../rls/lex.go: the text after a glued tag is kept.
func TestGluedTag(t *testing.T) {
	r := ParseRls("Album.VLS2004.FLAC-GRP")
	if len(r.Audio) != 1 || r.Audio[0] != "FLAC" {
		t.Errorf("audio %q, want [FLAC]", r.Audio)
	}
}

// The channels fix in ../rls/rls.go: STEREO, discarded as channels when 16-bit
// makes the name an app, stays as the word instead of panicking.
func TestDiscardedStereo(t *testing.T) {
	r := Parse("Obsession (2025) 1080p Blu-Ray x264 16-bit STEREO WAV MP4-CREATiVE24")
	var un []string
	for _, tag := range r.Unused() {
		un = append(un, fmt.Sprintf("%s", tag))
	}
	if u := strings.Join(un, " "); r.Channels != "" || u != "Blu-Ray STEREO" {
		t.Errorf("channels %q unused %q", r.Channels, u)
	}
}
