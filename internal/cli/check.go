package cli

import (
	"errors"

	"github.com/spf13/cobra"
)

func newCheckCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "check",
		Short: "Validate the hand-edited tables against the records",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			return errors.New("check is not implemented")
		},
	}
}
