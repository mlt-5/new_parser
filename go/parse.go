// Package parse is Bard's release-name parser in Go: rls (../rls) plus the
// entries in ../vocab/ and the leading-group step, the same as parse() in
// ../src/index.ts.
package parse

import (
	_ "embed"
	"regexp"
	"strings"
	"sync"

	"github.com/autobrr/rls"
	"github.com/autobrr/rls/taginfo"
)

// vocab.csv is generated from ../vocab/ by scripts/gen-vocab-csv.mjs.
//
//go:embed vocab.csv
var vocabCsv []byte

var (
	once        sync.Once
	parser      rls.Parser
	listedGroup taginfo.FindFunc
)

func build() {
	infos := taginfo.MustLoadBytes(vocabCsv)
	parser = rls.NewTagParser(taginfo.All(infos), rls.DefaultLexers()...)
	listedGroup = taginfo.Find(infos["group"]...)
}

// Parse parses a release name: rls plus the entries in ../vocab/.
func Parse(name string) rls.Release {
	once.Do(build)
	return leadingGroup(name, parser.ParseRelease([]byte(name)))
}

// ParseRls parses a release name with plain rls.
func ParseRls(name string) rls.Release {
	return rls.ParseString(name)
}

var leadingBracket = regexp.MustCompile(`^\s*\[([^\]]+)\]`)

// leadingGroup: fansub names put the group first: '[SubsPlease] Title - 04
// (1080p) [hash]'. rls reads that bracket as the site and looks for the group
// after the last '-'. When the bracket holds a group listed in ../vocab/group.ts,
// it is the group (as written) instead, and not the site.
func leadingGroup(name string, r rls.Release) rls.Release {
	m := leadingBracket.FindStringSubmatch(name)
	if m == nil {
		return r
	}
	x := strings.Trim(m[1], "\t\n\f\r ")
	if x == "" || listedGroup(x) == nil {
		return r
	}
	r.Group = x
	if r.Site == x {
		r.Site = ""
	}
	return r
}
