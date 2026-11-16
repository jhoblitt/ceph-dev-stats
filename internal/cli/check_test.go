package cli_test

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/cli"
	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
	"github.com/jhoblitt/ceph-dev-stats/internal/tables"
	"github.com/jhoblitt/ceph-dev-stats/internal/tracker"
)

var _ = Describe("check", func() {
	var (
		stdout  *bytes.Buffer
		dataDir string
	)

	BeforeEach(func() {
		stdout = &bytes.Buffer{}
		dataDir = GinkgoT().TempDir()
		for _, name := range []string{tables.ToolsFile, tables.BotsFile, tables.CommandsFile, tables.LabelsFile, tables.KindsFile} {
			b, err := os.ReadFile(filepath.Join("..", "..", "data", name))
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(filepath.Join(dataDir, name), b, 0o600)).To(Succeed())
		}
	})

	run := func(args ...string) error {
		args = append([]string{"check", "--data", dataDir}, args...)
		return cli.Run(context.Background(), args, &bytes.Buffer{}, stdout, &bytes.Buffer{})
	}

	writeData := func(ticketType string) {
		GinkgoHelper()
		opened := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
		_, err := record.WriteRecords(dataDir, []record.Record{{
			Number: 7, Updated: opened, Created: opened, Base: "main", State: record.StateOpen,
			Author:     record.Actor{Login: "alice"},
			Labels:     []string{"rgw"},
			Comments:   []record.Comment{{At: opened, By: "alice", Text: "jenkins test make check"}},
			Disclosure: record.Disclosure{Trailers: []string{"Assisted-by: Claude Code"}},
			KindHints:  &record.KindHints{Tickets: []int{90000}},
		}})
		Expect(err).NotTo(HaveOccurred())
		_, err = record.WriteMeta(dataDir, record.Meta{
			Repo: "ceph/ceph", WindowStart: fetch.WindowStart, FetchedThrough: opened,
			GitHubCounts: record.Counts{OpenedInWindow: 1, Open: 1},
		})
		Expect(err).NotTo(HaveOccurred())
		_, err = tracker.Write(dataDir, map[int]tracker.Ticket{90000: {Type: ticketType}})
		Expect(err).NotTo(HaveOccurred())
	}

	It("passes the seed tables alone, with no records, meta or tickets", func() {
		Expect(run("--report")).To(Succeed())
		Expect(stdout.String()).To(ContainSubstring("Counts: no meta.json to compare with\n"))
		Expect(stdout.String()).To(ContainSubstring("Base branches: 0\n"))
	})

	It("reads the records, meta and tickets beside the tables", func() {
		writeData("Bug")

		Expect(run("--report")).To(Succeed())
		Expect(stdout.String()).To(ContainSubstring("Counts: 1 opened in the window (GitHub: 1), 1 open (GitHub: 1)\n"))
		Expect(stdout.String()).To(ContainSubstring("Base branches: 1\n      1  main\n"))
	})

	It("fails, listing the problems it found", func() {
		writeData("Weird")

		Expect(run()).To(MatchError(ContainSubstring(`ticket type "Weird"`)))
	})

	It("fails on a broken table, naming it", func() {
		Expect(os.WriteFile(filepath.Join(dataDir, tables.CommandsFile), []byte("comands: []\n"), 0o600)).To(Succeed())

		Expect(run()).To(MatchError(And(
			ContainSubstring(filepath.Join(dataDir, tables.CommandsFile)),
			ContainSubstring("field comands not found"),
		)))
	})

	It("lists at most --top entries in each report", func() {
		writeData("Bug")

		Expect(run("--report", "--top", "0")).To(Succeed())
		Expect(stdout.String()).To(ContainSubstring("Base branches: 1\n"))
		Expect(stdout.String()).NotTo(ContainSubstring("more\n"))
	})

	It("prints no report, and so no login, without --report", func() {
		writeData("Bug")

		Expect(run()).To(Succeed())
		Expect(stdout.String()).To(BeEmpty())
	})

	It("prints the reports, logins among them, with --report", func() {
		writeData("Bug")

		Expect(run("--report")).To(Succeed())
		Expect(stdout.String()).To(ContainSubstring("Accounts with the most comments, not typed bots by GitHub: 1\n      1  alice\n"))
	})

	It("prints only its problems on failure without --report", func() {
		writeData("Weird")

		Expect(run()).To(MatchError(ContainSubstring(`ticket type "Weird"`)))
		Expect(stdout.String()).To(BeEmpty())
	})
})
