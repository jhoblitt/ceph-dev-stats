package ghapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

type reply struct {
	status int
	header map[string]string
	body   string
}

type received struct {
	auth string
	body map[string]any
}

// scripted answers the n-th request with replies[n], repeating the last one.
type scripted struct {
	mu       sync.Mutex
	replies  []reply
	requests []received
}

func (s *scripted) script(replies ...reply) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.replies = replies
}

func (s *scripted) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	Expect(err).NotTo(HaveOccurred())
	var body map[string]any
	Expect(json.Unmarshal(raw, &body)).To(Succeed())

	s.mu.Lock()
	n := len(s.requests)
	s.requests = append(s.requests, received{auth: r.Header.Get("Authorization"), body: body})
	rep := s.replies[min(n, len(s.replies)-1)]
	s.mu.Unlock()

	for k, v := range rep.header {
		w.Header().Set(k, v)
	}
	w.WriteHeader(rep.status)
	fmt.Fprint(w, rep.body)
}

func (s *scripted) received() []received {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]received{}, s.requests...)
}

const (
	token = "s3cr3t-token"
	// resetEpoch is 2026-11-15T13:00:00Z.
	resetEpoch = "1794747600"
)

var probe = ghapi.Query{Name: "Probe", Text: "query Probe { viewer { login } }"}

var _ = Describe("Client", func() {
	var (
		handler  *scripted
		server   *httptest.Server
		client   *ghapi.Client
		attempts []int
	)

	BeforeEach(func() {
		handler = &scripted{}
		server = httptest.NewServer(handler)
		DeferCleanup(server.Close)
		attempts = nil
		client = ghapi.NewClient(server.URL, token,
			ghapi.WithHTTPClient(server.Client()),
			ghapi.WithBackoff(func(_ context.Context, attempt int) error {
				attempts = append(attempts, attempt)
				return nil
			}))
	})

	do := func() (map[string]any, error) {
		var out map[string]any
		err := client.Do(context.Background(), probe, map[string]any{"n": 3}, &out)
		return out, err
	}

	It("posts the query with the token and decodes data", func() {
		handler.script(reply{status: 200, body: `{"data":{"viewer":{"login":"octo"}}}`})

		out, err := do()

		Expect(err).NotTo(HaveOccurred())
		Expect(out).To(HaveKeyWithValue("viewer", HaveKeyWithValue("login", "octo")))
		got := handler.received()
		Expect(got).To(HaveLen(1))
		Expect(got[0].auth).To(Equal("bearer " + token))
		Expect(got[0].body).To(Equal(map[string]any{
			"query":         probe.Text,
			"operationName": "Probe",
			"variables":     map[string]any{"n": 3.0},
		}))
	})

	It("retries an empty body and a 5xx with backoff, then succeeds", func() {
		handler.script(
			reply{status: 200, body: ""},
			reply{status: 502, body: "<html>bad gateway</html>"},
			reply{status: 200, body: `{"data":{"viewer":{"login":"octo"}}}`},
		)

		out, err := do()

		Expect(err).NotTo(HaveOccurred())
		Expect(out).To(HaveKey("viewer"))
		Expect(handler.received()).To(HaveLen(3))
		Expect(attempts).To(Equal([]int{1, 2}))
	})

	It("gives up with ErrUnavailable after three failed attempts", func() {
		handler.script(reply{status: 503, body: "unavailable"})

		_, err := do()

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(err.Error()).To(ContainSubstring("503"))
		Expect(handler.received()).To(HaveLen(3))
		Expect(attempts).To(Equal([]int{1, 2}))
	})

	It("treats a body without data or errors as empty", func() {
		handler.script(reply{status: 200, body: `{"data":null}`})

		_, err := do()

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(handler.received()).To(HaveLen(3))
	})

	It("stops when the backoff fails", func() {
		handler.script(reply{status: 502})
		canceled := errors.New("canceled")
		client = ghapi.NewClient(server.URL, token,
			ghapi.WithHTTPClient(server.Client()),
			ghapi.WithBackoff(func(context.Context, int) error { return canceled }))

		_, err := do()

		Expect(err).To(MatchError(canceled))
		Expect(handler.received()).To(HaveLen(1))
	})

	DescribeTable("reports an exhausted rate limit with its reset time, without retrying",
		func(rep reply) {
			handler.script(rep)

			_, err := do()

			rl, ok := errors.AsType[*ghapi.RateLimitError](err)
			Expect(ok).To(BeTrue(), "error %v is not a RateLimitError", err)
			Expect(rl.Reset).To(BeTemporally("==", time.Date(2026, 11, 15, 13, 0, 0, 0, time.UTC)))
			Expect(err.Error()).To(ContainSubstring("2026-11-15T13:00:00Z"))
			Expect(handler.received()).To(HaveLen(1))
		},
		Entry("HTTP 403 with no remaining allowance", reply{
			status: 403,
			header: map[string]string{"x-ratelimit-remaining": "0", "x-ratelimit-reset": resetEpoch},
			body:   `{"message":"API rate limit exceeded"}`,
		}),
		Entry("HTTP 429 with no remaining allowance", reply{
			status: 429,
			header: map[string]string{"x-ratelimit-remaining": "0", "x-ratelimit-reset": resetEpoch},
		}),
		Entry("HTTP 200 with a RATE_LIMITED GraphQL error", reply{
			status: 200,
			header: map[string]string{"x-ratelimit-remaining": "0", "x-ratelimit-reset": resetEpoch},
			body:   `{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded for user ID 1."}]}`,
		}),
	)

	It("fails on any other GraphQL error, naming its message, without retrying", func() {
		handler.script(reply{status: 200, body: `{"errors":[{"type":"NOT_FOUND","message":"Could not resolve to a Repository"}]}`})

		_, err := do()

		Expect(err).To(MatchError(ContainSubstring("Could not resolve to a Repository")))
		Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
		Expect(handler.received()).To(HaveLen(1))
	})

	It("fails on a 4xx without retrying and keeps the token out of the error", func() {
		handler.script(reply{status: 401, body: `{"message":"Bad credentials"}`})

		_, err := do()

		Expect(err).To(MatchError(ContainSubstring("401")))
		Expect(err.Error()).NotTo(ContainSubstring(token))
		Expect(handler.received()).To(HaveLen(1))
	})
})
