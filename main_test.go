package main

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_goroutineGroups(t *testing.T) {
	groups, err := goroutineTimeline(filepath.Join("testdata", "net-http-122.trace"))
	require.NoError(t, err)
	fmt.Printf("groups: %v\n", groups)
}
