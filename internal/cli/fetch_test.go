package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/cli"
	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/fetch/fetchtest"
	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

var _ = Describe("fetch", func() {
	const token = "ghp_cli-spec-token-never-written"

	var (
		stderr   *bytes.Buffer
		server   *fetchtest.Server
		cacheDir string
		dataDir  string
	)

	closedPR := func(number int, updated time.Time) fetch.Entry {
		return fetch.Entry{
			Number: number, Title: "pr", State: "CLOSED", CreatedAt: updated.Add(-time.Hour),
			UpdatedAt: updated, ClosedAt: &updated, BaseRefName: "main",
			Author: &fetch.Actor{Login: "alice", Typename: "User"},
		}
	}

	BeforeEach(func() {
		stderr = &bytes.Buffer{}
		cacheDir = GinkgoT().TempDir()
		dataDir = GinkgoT().TempDir()
		for _, key := range []string{"CEPHSTATS_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"} {
			GinkgoT().Setenv(key, "")
		}
		server = fetchtest.NewServer(
			closedPR(2, time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)),
			closedPR(1, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)),
		)
		DeferCleanup(server.Close)
	})

	run := func(args ...string) error {
		args = append([]string{
			"--log-level", "debug", "fetch",
			"--api-url", server.URL, "--cache-dir", cacheDir, "--data", dataDir,
		}, args...)
		return cli.Run(context.Background(), args, &bytes.Buffer{}, &bytes.Buffer{}, stderr)
	}

	cached := func() []string {
		des, err := os.ReadDir(filepath.Join(cacheDir, fetch.RawDir))
		Expect(err).NotTo(HaveOccurred())
		var names []string
		for _, de := range des {
			names = append(names, de.Name())
		}
		return names
	}

	It("is an error before any request when no token is in the environment", func() {
		Expect(run()).To(MatchError(ghapi.ErrNoToken))
		Expect(server.Requests()).To(BeEmpty())
	})

	It("sends the token from the environment and keeps it out of the logs and the cache", func() {
		GinkgoT().Setenv("GH_TOKEN", token)

		Expect(run()).To(Succeed())

		Expect(server.Requests()).To(HaveEach(HaveField("Authorization", "bearer "+token)))
		Expect(stderr.String()).To(ContainSubstring(`"msg":"walk finished"`))
		Expect(stderr.String()).NotTo(ContainSubstring(token))
		Expect(filepath.WalkDir(cacheDir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if bytes.Contains(b, []byte(token)) {
				return fmt.Errorf("token in %s", path)
			}
			return nil
		})).To(Succeed())
	})

	Context("with a token", func() {
		BeforeEach(func() {
			GinkgoT().Setenv("CEPHSTATS_GITHUB_TOKEN", token)
		})

		It("walks back to the window start when there is no data/meta.json", func() {
			Expect(run()).To(Succeed())
			Expect(cached()).To(ConsistOf("1.json", "2.json"))
		})

		It("walks back to a day before data/meta.json's fetched_through", func() {
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
				[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())

			Expect(run()).To(Succeed())

			Expect(cached()).To(ConsistOf("2.json"))
		})

		It("walks back to the window start with --full", func() {
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
				[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())

			Expect(run("--full")).To(Succeed())

			Expect(cached()).To(ConsistOf("1.json", "2.json"))
		})

		It("walks back to --since, and without data/meta.json leaves the coverage mark unwritten", func() {
			Expect(run("--since", "2026-11-01T00:00:00Z")).To(Succeed())

			Expect(cached()).To(ConsistOf("2.json"))
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile(),
				"the default since is the window start, earlier than --since")
			Expect(stderr.String()).To(ContainSubstring(`"msg":"coverage mark not advanced"`))
		})

		It("walks with --full though data/meta.json is malformed, never reading it", func() {
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"), []byte(`{"fetched_through":"yesterday"}`), 0o600)).To(Succeed())

			Expect(run("--full")).To(Succeed())

			Expect(cached()).To(ConsistOf("1.json", "2.json"))
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).To(BeAnExistingFile())
		})

		Context("when the cache holds an entry of an older format", func() {
			BeforeEach(func() {
				Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
					[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())
				b, err := json.Marshal(closedPR(1, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)))
				Expect(err).NotTo(HaveOccurred())
				Expect(os.MkdirAll(filepath.Join(cacheDir, fetch.RawDir), 0o750)).To(Succeed())
				Expect(os.WriteFile(filepath.Join(cacheDir, fetch.RawDir, "1.json"), b, 0o600)).To(Succeed())
			})

			It("walks back to the window start without --since, refetching it", func() {
				Expect(run()).To(Succeed())

				Expect(fetch.ReadEntry(cacheDir, 1)).To(HaveField("FormatVersion", fetch.FormatVersion))
				Expect(stderr.String()).To(ContainSubstring(`"msg":"cache holds entries of an older format"`))
			})

			It("walks back only to --since, and warns", func() {
				Expect(run("--since", "2026-11-01T00:00:00Z")).To(Succeed())

				Expect(fetch.ReadEntry(cacheDir, 1)).To(HaveField("FormatVersion", 0))
				Expect(stderr.String()).To(ContainSubstring(`"msg":"cache holds entries of an older format"`))
			})
		})

		DescribeTable("writes the cache's meta.json only when the walk covers the default range",
			func(written bool, args ...string) {
				Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
					[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())

				Expect(run(args...)).To(Succeed())

				meta := filepath.Join(cacheDir, fetch.MetaFile)
				if written {
					Expect(meta).To(BeAnExistingFile())
				} else {
					Expect(meta).NotTo(BeAnExistingFile())
					Expect(stderr.String()).To(ContainSubstring(`"msg":"coverage mark not advanced"`))
				}
			},
			Entry("without --since", true),
			Entry("with --full", true, "--full"),
			Entry("with a --since before the default", true, "--since", "2026-11-01T00:00:00Z"),
			Entry("with a --since later than the default", false, "--since", "2026-11-14T00:00:00Z"),
		)

		It("rejects a --since when data/meta.json cannot be read, before any request", func() {
			path := filepath.Join(dataDir, "meta.json")
			Expect(os.WriteFile(path, []byte(`{"fetched_through":"yesterday"}`), 0o600)).To(Succeed())

			Expect(run("--since", "2026-11-01T00:00:00Z")).To(MatchError(ContainSubstring(path)))
			Expect(server.Requests()).To(BeEmpty())
		})

		// The host is under .invalid, so a regression fails at name
		// resolution rather than reaching anyone.
		It("refuses a plain-http --api-url to a host that is not loopback, saying why", func() {
			err := run("--api-url", "http://api.example.invalid/graphql")

			Expect(err).To(MatchError("API URL http://api.example.invalid/graphql: scheme must be https, or http to a loopback host, so that the token is not sent in clear text"))
		})

		It("rejects a --since that is not RFC 3339", func() {
			Expect(run("--since", "2026-11-01")).To(MatchError(ContainSubstring("--since")))
			Expect(server.Requests()).To(BeEmpty())
		})

		It("rejects --since with --full", func() {
			Expect(run("--full", "--since", "2026-11-01T00:00:00Z")).To(MatchError("--since and --full are mutually exclusive"))
		})
	})
})
