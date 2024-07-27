package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/exp/trace"
)

func main() {
	flag.Parse()
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir("assets")))
	mux.Handle("/goroutines.json", goroutineHandler(flag.Arg(0)))
	slog.Info("Listening on localhost:8080")
	http.ListenAndServe("localhost:8080", mux)
}

func goroutineHandler(tracePath string) http.HandlerFunc {
	var (
		done = make(chan struct{})
		res  = &GoroutineTimeline{}
	)
	go func() {
		start := time.Now()
		var err error
		res, err = goroutineTimeline(tracePath)
		if err != nil {
			res.Error = err.Error()
			slog.Error("failed to parse trace", "err", err.Error())
		} else {
			slog.Info("parsed trace", "duration", time.Since(start))
		}
		close(done)
	}()
	return func(w http.ResponseWriter, r *http.Request) {
		<-done
		out, _ := json.Marshal(res)
		w.Write(out)
	}
}

type stringID int

type GoroutineTimeline struct {
	Goroutines map[int]*Goroutine `json:"goroutines"`
	Strings    []string           `json:"strings"`
	Error      string             `json:"error"`

	strings map[string]stringID
}

type Goroutine struct {
	Name   float64     `json:"name"`
	Events [][]float64 `json:"events"`
}

func (g *GoroutineTimeline) StringID(s string) stringID {
	if g.strings == nil {
		g.strings = make(map[string]stringID)
	}
	if id, ok := g.strings[s]; ok {
		return id
	}
	id := stringID(len(g.Strings))
	g.Strings = append(g.Strings, s)
	g.strings[s] = id
	return id
}

func goroutineTimeline(path string) (*GoroutineTimeline, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	r, err := trace.NewReader(file)
	if err != nil {
		log.Fatal(err)
	}

	tl := &GoroutineTimeline{
		Goroutines: make(map[int]*Goroutine),
	}
	tl.StringID("")
	var (
		prevTime trace.Time
		minTime  trace.Time = -1
	)
	for {
		// Read the event.
		ev, err := r.ReadEvent()
		if err == io.EOF {
			break
		} else if err != nil {
			return nil, err
		}

		// Process it.
		switch ev.Kind() {
		case trace.EventStateTransition:
			// Check that events are in order.
			if ev.Time() < prevTime {
				return nil, fmt.Errorf("events not in order: %v < %v", ev.Time(), prevTime)
			}
			// Update the minimum time.
			if minTime == -1 {
				minTime = ev.Time()
			}

			st := ev.StateTransition()
			switch {
			case st.Resource.Kind == trace.ResourceGoroutine:
				goID := st.Resource.Goroutine()
				g, ok := tl.Goroutines[int(goID)]
				if !ok {
					g = &Goroutine{}
					tl.Goroutines[int(goID)] = g
				}
				_, to := st.Goroutine()
				timestamp := float64(ev.Time()-minTime) / 1e6
				stateSID := float64(tl.StringID(strings.ToLower(to.String())))
				event := []float64{timestamp, stateSID}
				g.Events = append(g.Events, event)

				if g.Name == 0 {
					var last trace.StackFrame
					st.Stack.Frames(func(f trace.StackFrame) bool {
						last = f
						return true
					})
					g.Name = float64(tl.StringID(last.Func))
				}
				if g.Name == 0 {
					var last trace.StackFrame
					ev.Stack().Frames(func(f trace.StackFrame) bool {
						last = f
						return true
					})
					g.Name = float64(tl.StringID(last.Func))
				}
			}
			prevTime = ev.Time()

		case trace.EventStackSample:
			goID := ev.Goroutine()
			if goID == trace.NoGoroutine {
				continue
			}
			g, ok := tl.Goroutines[int(goID)]
			if !ok {
				g = &Goroutine{}
				tl.Goroutines[int(goID)] = g
			}
			if g.Name == 0 {
				fmt.Printf("g.Name: %v\n", g.Name)
				var last trace.StackFrame
				ev.Stack().Frames(func(f trace.StackFrame) bool {
					last = f
					return true
				})
				g.Name = float64(tl.StringID(last.Func))
			}
		}
	}

	return tl, nil
}
