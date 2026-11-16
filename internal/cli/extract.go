package cli

import (
	"errors"

	"github.com/spf13/cobra"
)

func newExtractCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "extract",
		Short: "Turn the cached pull requests into the committed per-PR records",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			return errors.New("extract is not implemented")
		},
	}
}
