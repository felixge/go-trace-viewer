package main

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func Test_goroutineGroups(t *testing.T) {
	groups, err := goroutineGroups("nicky.trace")
	require.NoError(t, err)
	fmt.Printf("groups: %v\n", groups)
}
