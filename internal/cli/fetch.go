package cli

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

func newFetchCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fetch",
		Short: "Walk ceph/ceph pull requests from GitHub into the local raw cache",
		Long: `Walk ceph/ceph pull requests from GitHub into the local raw cache.

The GitHub token is read from CEPHSTATS_GITHUB_TOKEN, GH_TOKEN or
GITHUB_TOKEN, in that order.`,
		Args: cobra.NoArgs,
		PreRunE: func(*cobra.Command, []string) error {
			if v.GetBool("full") && v.GetString("since") != "" {
				return errors.New("--since and --full are mutually exclusive")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			token, err := ghapi.Token(os.Getenv)
			if err != nil {
				return err
			}
			since, isDefault, err := fetchSince(v)
			if err != nil {
				return err
			}
			client := ghapi.NewClient(v.GetString("api-url"), token)
			return fetch.Run(cmd.Context(), client, fetch.Config{
				CacheDir:       v.GetString("cache-dir"),
				Since:          since,
				SinceIsDefault: isDefault,
			})
		},
	}
	f := cmd.Flags()
	f.String("since", "", "walk back to pull requests updated at this RFC 3339 time; default a day before the data directory's fetched_through, or the window start (CEPHSTATS_SINCE)")
	f.Bool("full", false, "walk back to the window start (CEPHSTATS_FULL)")
	f.String("cache-dir", ".cache", "raw cache directory (CEPHSTATS_CACHE_DIR)")
	f.String("data", "data", "committed data directory, read for meta.json (CEPHSTATS_DATA)")
	f.String("api-url", ghapi.DefaultEndpoint, "GitHub GraphQL endpoint (CEPHSTATS_API_URL)")
	return cmd
}

// fetchSince is where the walk starts, and whether that is the default
// rather than what --since or --full asked for.
func fetchSince(v *viper.Viper) (time.Time, bool, error) {
	if v.GetBool("full") {
		return fetch.WindowStart, false, nil
	}
	if s := v.GetString("since"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return time.Time{}, false, fmt.Errorf("parsing --since: %w", err)
		}
		return t.UTC(), false, nil
	}
	since, err := fetch.DefaultSince(v.GetString("data"))
	return since, true, err
}
