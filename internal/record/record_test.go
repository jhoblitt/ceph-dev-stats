package record_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

func at(s string) time.Time {
	GinkgoHelper()
	t, err := time.Parse(time.RFC3339, s)
	Expect(err).NotTo(HaveOccurred())
	return t
}

// minimal is a record with every list empty, opened at created.
func minimal(number int, created string) record.Record {
	return record.Record{
		Number:   number,
		Updated:  at(created),
		Title:    "a pull request",
		Author:   record.Actor{Login: "alice"},
		Base:     "main",
		Created:  at(created),
		State:    record.StateOpen,
		Labels:   []string{},
		Events:   []record.Event{},
		Reviews:  []record.Review{},
		Comments: []record.Comment{},
		Disclosure: record.Disclosure{
			Trailers: []string{}, Description: []string{}, CommitProse: []string{},
		},
	}
}

func readFile(path string) string {
	GinkgoHelper()
	b, err := os.ReadFile(path)
	Expect(err).NotTo(HaveOccurred())
	return string(b)
}

var _ = Describe("records", func() {
	var dataDir string

	BeforeEach(func() {
		dataDir = GinkgoT().TempDir()
	})

	monthFile := func(month string) string {
		return filepath.Join(dataDir, record.PRsDir, month+".jsonl")
	}

	It("writes a record as one line with Seam 2's keys in order and no HTML escaping", func() {
		r := record.Record{
			Number:      71234,
			Updated:     at("2026-06-02T10:00:00Z"),
			Title:       "rgw: a <title> & more",
			Author:      record.Actor{Login: "alice"},
			Association: "member",
			Base:        "main",
			Created:     at("2026-05-20T08:00:00Z"),
			State:       record.StateMerged,
			Additions:   10,
			Deletions:   2,
			Files:       3,
			Labels:      []string{"core", "rgw"},
			Commits: record.Commits{
				Count:         2,
				FirstAuthored: new(at("2026-05-19T07:00:00Z")),
				LastCommitted: new(at("2026-05-21T09:00:00Z")),
			},
			PriorPRs: new(5),
			Events:   []record.Event{{At: at("2026-06-01T00:00:00Z"), Kind: record.KindMerged}},
			Reviews: []record.Review{
				{At: at("2026-05-30T00:00:00Z"), By: "bob", State: record.ReviewApproved},
			},
			Comments: []record.Comment{
				{At: at("2026-05-21T00:00:00Z"), By: "carol", Text: "jenkins test make check"},
				{At: at("2026-05-22T00:00:00Z"), By: "github-actions", Bot: true},
			},
			Disclosure: record.Disclosure{
				Trailers: []string{"Assisted-by: Claude"}, Description: []string{}, CommitProse: []string{},
			},
		}

		Expect(record.WriteRecords(dataDir, []record.Record{r})).To(ConsistOf(monthFile("2026-05")))

		Expect(readFile(monthFile("2026-05"))).To(Equal(
			`{"number":71234,"updated":"2026-06-02T10:00:00Z","title":"rgw: a <title> & more",` +
				`"author":{"login":"alice","bot":false},"association":"member","base":"main",` +
				`"created":"2026-05-20T08:00:00Z","state":"merged","draft":false,` +
				`"additions":10,"deletions":2,"files":3,"labels":["core","rgw"],` +
				`"commits":{"count":2,"first_authored":"2026-05-19T07:00:00Z","last_committed":"2026-05-21T09:00:00Z"},` +
				`"prior_prs":5,` +
				`"events":[{"at":"2026-06-01T00:00:00Z","kind":"merged"}],` +
				`"reviews":[{"at":"2026-05-30T00:00:00Z","by":"bob","bot":false,"state":"approved"}],` +
				`"comments":[{"at":"2026-05-21T00:00:00Z","by":"carol","bot":false,"text":"jenkins test make check"},` +
				`{"at":"2026-05-22T00:00:00Z","by":"github-actions","bot":true}],` +
				`"disclosure":{"trailers":["Assisted-by: Claude"],"description":[],"commit_prose":[]}}` + "\n"))
	})

	It("writes null for a PR with no commits and no prior-PR count", func() {
		Expect(record.WriteRecords(dataDir, []record.Record{minimal(1, "2026-05-20T08:00:00Z")})).Error().NotTo(HaveOccurred())

		Expect(readFile(monthFile("2026-05"))).To(ContainSubstring(
			`"commits":{"count":0,"first_authored":null,"last_committed":null},"prior_prs":null,`))
	})

	It("files each record under the UTC month it was opened, sorted by number", func() {
		recs := []record.Record{
			minimal(30, "2026-06-01T00:00:00Z"),
			minimal(12, "2026-05-31T23:59:59Z"),
			minimal(10, "2026-05-15T00:00:00Z"),
			minimal(11, "2019-03-02T00:00:00Z"),
		}

		written, err := record.WriteRecords(dataDir, recs)

		Expect(err).NotTo(HaveOccurred())
		Expect(written).To(Equal([]string{monthFile("2019-03"), monthFile("2026-05"), monthFile("2026-06")}))
		Expect(readFile(monthFile("2026-05"))).To(MatchRegexp(`^\{"number":10,[^\n]*\n\{"number":12,[^\n]*\n$`))
		Expect(readFile(monthFile("2019-03"))).To(MatchRegexp(`^\{"number":11,[^\n]*\n$`))
		Expect(readFile(monthFile("2026-06"))).To(MatchRegexp(`^\{"number":30,[^\n]*\n$`))
	})

	It("reads back what it wrote, sorted by number, and writing that again changes no file", func() {
		r := minimal(7, "2026-07-04T12:00:00Z")
		r.PriorPRs = new(0)
		r.Commits = record.Commits{Count: 1, FirstAuthored: new(at("2026-07-01T00:00:00Z")), LastCommitted: new(at("2026-07-02T00:00:00Z"))}
		r.Comments = []record.Comment{{At: at("2026-07-05T00:00:00Z"), By: "ghost"}}
		recs := []record.Record{r, minimal(3, "2026-07-01T00:00:00Z"), minimal(5, "2026-05-16T00:00:00Z")}
		_, err := record.WriteRecords(dataDir, recs)
		Expect(err).NotTo(HaveOccurred())
		before := readFile(monthFile("2026-07"))

		got, err := record.ReadRecords(dataDir)
		Expect(err).NotTo(HaveOccurred())
		Expect(got).To(HaveLen(3))
		Expect(got[0].Number).To(Equal(3))
		Expect(got[1].Number).To(Equal(5))
		Expect(got[2]).To(Equal(r))

		Expect(record.WriteRecords(dataDir, got)).To(BeEmpty())
		Expect(readFile(monthFile("2026-07"))).To(Equal(before))
	})

	It("rewrites only the month whose records changed", func() {
		may, june := minimal(1, "2026-05-20T00:00:00Z"), minimal(2, "2026-06-20T00:00:00Z")
		_, err := record.WriteRecords(dataDir, []record.Record{may, june})
		Expect(err).NotTo(HaveOccurred())

		june.State = record.StateClosed
		Expect(record.WriteRecords(dataDir, []record.Record{may, june})).To(Equal([]string{monthFile("2026-06")}))
	})

	It("writes nothing, not even the directory, when there are no records", func() {
		Expect(record.WriteRecords(dataDir, nil)).To(BeEmpty())
		Expect(filepath.Join(dataDir, record.PRsDir)).NotTo(BeAnExistingFile())
	})

	It("reads no records from a data directory without prs/", func() {
		Expect(record.ReadRecords(dataDir)).To(BeEmpty())
	})

	It("is an error naming the file and line of a malformed record", func() {
		Expect(os.MkdirAll(filepath.Join(dataDir, record.PRsDir), 0o750)).To(Succeed())
		Expect(os.WriteFile(monthFile("2026-05"), []byte("{\"number\":1}\nnot json\n"), 0o600)).To(Succeed())

		_, err := record.ReadRecords(dataDir)

		Expect(err).To(MatchError(ContainSubstring(monthFile("2026-05") + ":2")))
	})

	It("reads a record carrying fields it does not know, or lacking some", func() {
		Expect(os.MkdirAll(filepath.Join(dataDir, record.PRsDir), 0o750)).To(Succeed())
		Expect(os.WriteFile(monthFile("2026-05"), []byte(
			`{"number":1,"created":"2026-05-20T00:00:00Z","comments":[{"at":"2026-05-21T00:00:00Z","by":"bob","bot":false,"id":"IC_x"}],"later":{"list":[]}}`+"\n"+
				`{"number":2}`+"\n"), 0o600)).To(Succeed())

		got, err := record.ReadRecords(dataDir)

		Expect(err).NotTo(HaveOccurred())
		Expect(got).To(HaveLen(2))
		Expect(got[0].Comments).To(ConsistOf(HaveField("By", "bob")))
	})

	It("is an error when a pull request is recorded twice", func() {
		Expect(os.MkdirAll(filepath.Join(dataDir, record.PRsDir), 0o750)).To(Succeed())
		Expect(os.WriteFile(monthFile("2026-05"), []byte("{\"number\":4}\n"), 0o600)).To(Succeed())
		Expect(os.WriteFile(monthFile("2026-06"), []byte("{\"number\":4}\n"), 0o600)).To(Succeed())

		_, err := record.ReadRecords(dataDir)

		Expect(err).To(MatchError(ContainSubstring("pull request 4 is recorded twice")))
	})
})

var _ = Describe("meta", func() {
	var (
		dataDir, path string
		meta          record.Meta
	)

	BeforeEach(func() {
		dataDir = GinkgoT().TempDir()
		path = filepath.Join(dataDir, record.MetaFile)
		meta = record.Meta{
			Repo:           "ceph/ceph",
			WindowStart:    time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC),
			FetchedThrough: time.Date(2026, 11, 15, 12, 0, 1, 0, time.UTC),
			GitHubCounts:   record.Counts{OpenedInWindow: 4985, Open: 2019},
		}
	})

	It("writes the meta indented with its keys in order, and reads it back", func() {
		Expect(record.WriteMeta(dataDir, meta)).To(BeTrue())

		Expect(readFile(path)).To(Equal(`{
  "repo": "ceph/ceph",
  "window_start": "2026-05-15T00:00:00Z",
  "fetched_through": "2026-11-15T12:00:01Z",
  "github_counts": {
    "opened_in_window": 4985,
    "open": 2019
  }
}
`))
		Expect(record.ReadMeta(dataDir)).To(Equal(meta))
	})

	It("leaves an unchanged meta alone", func() {
		Expect(record.WriteMeta(dataDir, meta)).To(BeTrue())
		Expect(record.WriteMeta(dataDir, meta)).To(BeFalse())
	})

	It("is an error matching fs.ErrNotExist when there is no meta", func() {
		_, err := record.ReadMeta(dataDir)
		Expect(err).To(MatchError(fs.ErrNotExist))
	})

	It("is an error naming the file when fetched_through is missing", func() {
		Expect(os.WriteFile(path, []byte(`{"repo":"ceph/ceph"}`), 0o600)).To(Succeed())

		_, err := record.ReadMeta(dataDir)

		Expect(err).To(MatchError(path + " has no fetched_through"))
	})

	It("is an error naming the file when the meta is malformed", func() {
		Expect(os.WriteFile(path, []byte(`{"fetched_through":"yesterday"}`), 0o600)).To(Succeed())

		_, err := record.ReadMeta(dataDir)

		Expect(err).To(MatchError(ContainSubstring(path)))
	})
})

var _ = Describe("authors", func() {
	var dataDir string

	BeforeEach(func() {
		dataDir = GinkgoT().TempDir()
	})

	It("writes the baselines with sorted keys, and reads them back", func() {
		authors := map[string]int{"zed": 1, "alice": 4, "mallory": 0}

		Expect(record.WriteAuthors(dataDir, authors)).To(BeTrue())

		Expect(readFile(filepath.Join(dataDir, record.AuthorsFile))).To(Equal(`{
  "alice": 4,
  "mallory": 0,
  "zed": 1
}
`))
		Expect(record.ReadAuthors(dataDir)).To(Equal(authors))
		Expect(record.WriteAuthors(dataDir, authors)).To(BeFalse())
	})

	It("is an error matching fs.ErrNotExist when there are no baselines", func() {
		_, err := record.ReadAuthors(dataDir)
		Expect(err).To(MatchError(fs.ErrNotExist))
	})
})
