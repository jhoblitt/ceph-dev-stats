package cli

import (
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/jhoblitt/ceph-dev-stats/internal/extract"
)

func newExtractCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "extract",
		Short: "Turn the cached pull requests into the committed per-PR records",
		Long: `Turn the cached pull requests into the committed per-PR records.

A cached pull request replaces its record when it was updated since the
record was written; --all re-derives every record. Only the monthly files
whose content changes are rewritten.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return extract.Run(cmd.Context(), extract.Config{
				CacheDir: v.GetString("cache-dir"),
				DataDir:  v.GetString("data"),
				All:      v.GetBool("all"),
			})
		},
	}
	f := cmd.Flags()
	f.Bool("all", false, "re-derive the record of every cached pull request (CEPHSTATS_ALL)")
	f.String("cache-dir", ".cache", "raw cache directory (CEPHSTATS_CACHE_DIR)")
	f.String("data", "data", "committed data directory (CEPHSTATS_DATA)")
	return cmd
}
