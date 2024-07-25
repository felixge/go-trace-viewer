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
	"time"

	"golang.org/x/exp/trace"
)

func main() {
	flag.Parse()
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir("assets")))
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
		res.Goroutines, err = goroutineGroups(tracePath)
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
		out, _ := json.MarshalIndent(res, "", "  ")
		w.Write(out)
	}
}

type GoroutineTimeline struct {
	Goroutines []*Goroutine `json:"goroutines"`
	Error      string       `json:"error"`
}

type Goroutine struct {
	ID     int      `json:"id"`
	Name   string   `json:"name"`
	Events []*Event `json:"events"`
}

type Event struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	State string `json:"state"`
}

func goroutineGroups(path string) ([]*Goroutine, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	// Start reading from STDIN.
	r, err := trace.NewReader(file)
	if err != nil {
		log.Fatal(err)
	}

	type transition struct {
		from string
		to   string
	}
	m := map[transition]int{}
	for {
		// Read the event.
		ev, err := r.ReadEvent()
		if err == io.EOF {
			break
		} else if err != nil {
			return nil, err
		}

		// Process it.
		if ev.Kind() == trace.EventStateTransition {
			st := ev.StateTransition()
			if st.Resource.Kind == trace.ResourceGoroutine {
				from, to := st.Goroutine()
				t := transition{from.String(), to.String()}

				// fmt.Printf("ev.Time(): %v\n", ev.Time())

				m[t]++
				// fmt.Printf("from: %v\n", from)
				// fmt.Printf("to: %v\n", to)
				// Look for goroutines blocking, and count them.
				// if from.Executing() && to == trace.GoWaiting {
				// 	blocked++
				// 	if strings.Contains(st.Reason, "network") {
				// 		blockedOnNetwork++
				// 	}
				// }
			}
		}
	}
	fmt.Printf("m: %v\n", m)

	return nil, nil
}
