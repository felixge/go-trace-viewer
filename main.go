package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"time"

	"strconv"

	"golang.org/x/exp/trace"
	"golang.org/x/sync/errgroup"
)

func main() {
	if err := mainErr(); err != nil {
		slog.Error("finished shutdown", "err", err.Error())
		os.Exit(1)
	}
	slog.Info("finished shutdown")
}

func mainErr() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	flag.Parse()

	var input io.ReadCloser
	if flag.NArg() == 0 || flag.Arg(0) == "-" {
		input = os.Stdin
	} else {
		file, err := os.Open(flag.Arg(0))
		if err != nil {
			return err
		}
		input = file
	}
	br := StartBatchReader(input)

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir("assets")))
	mux.Handle("/goroutines.json", goroutineHandler(br))

	server := &http.Server{
		Addr:    "localhost:8080",
		Handler: mux,
	}

	eg := &errgroup.Group{}
	eg.Go(func() error {
		defer func() {
			slog.Debug("stopped http server")
			cancel()
		}()
		slog.Info("starting http server", "addr", server.Addr)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			return err
		}
		return nil
	})
	eg.Go(func() error {
		defer func() {
			slog.Debug("stopped batch reader")
			// note: we're not calling cancel here because we might be dealing
			// with a trace that is partially corrupted, and we want to show as
			// much as possible.
		}()
		return br.Wait()
	})

	<-ctx.Done()

	slog.Info("shutting down")

	go br.Stop()
	go func() {
		shutdownCtx, _ := context.WithTimeout(context.Background(), 3*time.Second)
		server.Shutdown(shutdownCtx)
	}()

	return eg.Wait()
}

func StartBatchReader(r io.ReadCloser) *BatchReader {
	br := &BatchReader{
		r:         r,
		batchTick: make(chan struct{}),
		stopped:   make(chan struct{}),
		stopping:  make(chan struct{}),
		cond:      *sync.NewCond(&sync.Mutex{}),
	}
	go br.readLoop()
	return br
}

type BatchReader struct {
	r         io.ReadCloser
	err       error
	cond      sync.Cond
	batchTick chan struct{}
	stopping  chan struct{}
	stopped   chan struct{}
	batches   []*Batch
}

// ReadBatch reads the next batch of events that starts after the given time.
// It may block if such a batch is not available yet.
func (b *BatchReader) ReadBatch(start trace.Time) (*Batch, error) {
	b.cond.L.Lock()
	defer b.cond.L.Unlock()

	var i int
	for {
		// Check if we have the batch we are looking for
		if i < len(b.batches) {
			if batch := b.batches[i]; batch.Start > start {
				return batch, nil
			}
			i++
			continue
		}

		// If we have been stopped before reaching the part of the trace
		// containing the batch we are looking for, return an error.
		select {
		case <-b.stopped:
			return nil, b.err
		default:
		}

		// Wait for the next batch to be read. But limit the wait time to avoid
		// blocking indefinitely in case the reader is stopped between the above
		// b.stopped check and our call to b.cond.Wait().
		time.AfterFunc(time.Second, b.cond.Broadcast)
		b.cond.Wait()
	}
}

func (b *BatchReader) readLoop() {
	defer func() {
		closeErr := b.r.Close()
		if b.err == nil {
			b.err = closeErr
		}
		b.cond.Broadcast()
		close(b.stopped)
	}()

	r, err := trace.NewReader(b.r)
	if err != nil {
		b.err = err
		return
	}

	var batch *Batch
	var deltaEncode func(trace.Time) trace.Time
	for i := 0; ; i++ {
		// Read the next event.
		ev, err := r.ReadEvent()

		// Start a new batch if needed.
		if batch == nil || batch.Events == 100000 || err == io.EOF {
			if batch != nil {
				b.cond.L.Lock()
				b.batches = append(b.batches, batch)
				b.cond.L.Unlock()
				b.cond.Broadcast()
			}

			if err == nil {
				batch = NewBatch()
				batch.Start = ev.Time()
				deltaEncode = deltaEncoder(ev.Time())
			}
		}

		if err != nil {
			b.err = err
			return
		}

		batch.End = ev.Time()

		// Process it.
		switch ev.Kind() {
		case trace.EventStateTransition:
			st := ev.StateTransition()
			switch st.Resource.Kind {
			case trace.ResourceGoroutine:
				batch.Events++
				goID := st.Resource.Goroutine()
				g, ok := batch.Goroutines[int(goID)]
				if !ok {
					g = &Goroutine{prevTime: ev.Time()}
					batch.Goroutines[int(goID)] = g
				}
				from, to := st.Goroutine()
				timestamp := float64(deltaEncode(ev.Time()))
				stateSID := float64(batch.StringID(strings.ToLower(to.String())))
				event := []float64{timestamp, stateSID}
				g.Events = append(g.Events, event)

				if from == trace.GoRunning {
					g.Running += float64(ev.Time() - g.prevTime)
				}

				if g.Name == 0 {
					var last trace.StackFrame
					st.Stack.Frames(func(f trace.StackFrame) bool {
						last = f
						return true
					})
					g.Name = float64(batch.StringID(last.Func))
				}
				if g.Name == 0 {
					var last trace.StackFrame
					ev.Stack().Frames(func(f trace.StackFrame) bool {
						last = f
						return true
					})
					g.Name = float64(batch.StringID(last.Func))
				}
				g.prevTime = ev.Time()
			}

			// case trace.EventStackSample:
			// goID := ev.Goroutine()
			// if goID == trace.NoGoroutine {
			// 	continue
			// }
			// g, ok := batch.Goroutines[int(goID)]
			// if !ok {
			// 	g = &Goroutine{}
			// 	batch.Goroutines[int(goID)] = g
			// }
			// if g.Name == 0 {
			// 	fmt.Printf("g.Name: %v\n", g.Name)
			// 	var last trace.StackFrame
			// 	ev.Stack().Frames(func(f trace.StackFrame) bool {
			// 		last = f
			// 		return true
			// 	})
			// 	g.Name = float64(batch.StringID(last.Func))
			// }
		}
	}
}

func deltaEncoder(base trace.Time) func(trace.Time) trace.Time {
	return func(t trace.Time) trace.Time {
		// delta := t - base
		// base = t
		// return delta
		return t
	}
}

func (b *BatchReader) Wait() error {
	<-b.stopped
	if b.err == io.EOF {
		return nil
	}
	return b.err
}

func (b *BatchReader) Stop() {
	close(b.stopping)
}

func goroutineHandler(br *BatchReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start, err := parseTraceTime(r.URL.Query().Get("start"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		batch, err := br.ReadBatch(start)
		if err == io.EOF {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		out, _ := json.Marshal(batch)
		w.Write(out)
	}
}

func parseTraceTime(s string) (trace.Time, error) {
	if s == "" {
		return 0, nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, err
	}
	return trace.Time(v), nil
}

func NewBatch() *Batch {
	batch := &Batch{
		Goroutines: make(map[int]*Goroutine),
	}
	batch.StringID("")
	return batch
}

type BatchRes struct {
	*Batch
}

type Batch struct {
	ID         float64            `json:"id"`
	Start      trace.Time         `json:"start"`
	End        trace.Time         `json:"end"`
	Events     int64              `json:"events"`
	Goroutines map[int]*Goroutine `json:"goroutines"`
	Strings    []string           `json:"strings"`
	Error      string             `json:"error"`

	strings map[string]stringID
}

type stringID int
type Goroutine struct {
	Name    float64     `json:"name"`
	Running float64     `json:"running"`
	Events  [][]float64 `json:"events"`

	prevTime trace.Time
}

func (g *Batch) StringID(s string) stringID {
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
