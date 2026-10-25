// Prints Go rls output (all fields, unused text, every tag) as JSON lines for
// each name on stdin, to compare with the TypeScript port (compare.mjs).
// With -vocab it prints Bard's Go parse (../../go: rls plus vocab/ and the
// leading-group step) instead, to compare with the TypeScript parse().

package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	parse "bard/new_parser/go"
	"github.com/autobrr/rls"
)

type Out struct {
	Name string
	rls.Release
	TypeS          string
	SeriesEpisodes string
	Unused         string
	Tags           []string
	Panic          string `json:",omitempty"`
}

func main() {
	vocab := flag.Bool("vocab", false, "parse with vocab/ and the leading-group step")
	flag.Parse()
	do := parse.ParseRls
	if *vocab {
		do = parse.Parse
	}
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	enc := json.NewEncoder(os.Stdout)
	for sc.Scan() {
		enc.Encode(one(do, sc.Text()))
	}
}

// one parses a name; a Go panic is reported in Panic instead of ending the run.
func one(do func(string) rls.Release, name string) (out Out) {
	defer func() {
		if err := recover(); err != nil {
			out = Out{Name: name, Panic: fmt.Sprint(err)}
		}
	}()
	{
		r := do(name)
		var se []string
		if eps := r.SeriesEpisodes(); len(eps) > 1 {
			for _, ep := range eps {
				se = append(se, fmt.Sprintf("S%02dE%02d", ep[0], ep[1]))
			}
		}
		var un, tags []string
		for _, t := range r.Unused() {
			un = append(un, fmt.Sprintf("%s", t))
		}
		for _, t := range r.Tags() {
			tags = append(tags, fmt.Sprintf("%s|%o|%s", t.TagType(), t, t))
		}
		return Out{name, r, r.Type.String(), strings.Join(se, " "), strings.Join(un, " "), tags, ""}
	}
}
