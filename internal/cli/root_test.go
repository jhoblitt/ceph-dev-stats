package cli_test

import (
	"bytes"
	"context"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/cli"
)

var _ = Describe("Run", func() {
	var stdout, stderr *bytes.Buffer

	BeforeEach(func() {
		stdout = &bytes.Buffer{}
		stderr = &bytes.Buffer{}
	})

	run := func(args ...string) error {
		return cli.Run(context.Background(), args, &bytes.Buffer{}, stdout, stderr)
	}

	It("lists every subcommand in its help", func() {
		Expect(run("--help")).To(Succeed())
		for _, name := range []string{"fetch", "extract", "check", "rollup"} {
			Expect(stdout.String()).To(MatchRegexp(`(?m)^  %s\s`, name), "subcommand %q", name)
		}
	})

	It("rejects an unknown log format before running a subcommand", func() {
		Expect(run("--log-format", "xml", "fetch")).To(MatchError(`unknown log format "xml"`))
	})

	It("says a subcommand is not implemented yet", func() {
		for _, name := range []string{"check", "rollup"} {
			Expect(run(name)).To(MatchError(name+" is not implemented"), "subcommand %q", name)
		}
	})
})
