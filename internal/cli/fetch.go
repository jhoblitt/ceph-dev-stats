package cli

import (
	"errors"

	"github.com/spf13/cobra"
)

func newFetchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "fetch",
		Short: "Walk ceph/ceph pull requests from GitHub into the local raw cache",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			return errors.New("fetch is not implemented")
		},
	}
}
