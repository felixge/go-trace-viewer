package main

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/exp/trace"
)

func TestBatchReader(t *testing.T) {
	file, err := os.Open(filepath.Join("testdata", "net-http-122.trace"))
	require.NoError(t, err)

	br := StartBatchReader(file)
	t.Cleanup(br.Stop)

	var batches []*Batch
	for {
		var start trace.Time
		if len(batches) > 0 {
			start = batches[len(batches)-1].End
		}
		batch, err := br.ReadBatch(start)
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		require.NotZero(t, batch.Events)
		batches = append(batches, batch)
	}
	require.Len(t, batches, 46)
}

// func TestTrace(t *testing.T) {
// 	r, w := io.Pipe()
// 	rtrace.Start(w)
// 	prev := time.Now()
// 	tr, err := trace.NewReader(r)
// 	require.NoError(t, err)
// 	prev = time.Now()
// 	for i := 0; ; i++ {
// 		ev, err := tr.ReadEvent()
// 		fmt.Printf("time.Since(prev): %v\n", time.Since(prev))
// 		prev = time.Now()
// 		require.NoError(t, err)
// 		_ = ev
// 		// fmt.Printf("ev.String(): %v\n", ev.String())
// 	}
// }
