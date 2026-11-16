package cli

import (
	"errors"

	"github.com/spf13/cobra"
)

func newRollupCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "rollup",
		Short: "Write the statistics site's data from the records and the tables",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			return errors.New("rollup is not implemented")
		},
	}
}
