package ghapi

import (
	"fmt"
	"strings"
)

// Connection names one of a pull request's nested connections that the
// walk pages to the end.
type Connection string

// The nested connections, by their GraphQL field names.
const (
	Labels        Connection = "labels"
	Commits       Connection = "commits"
	Comments      Connection = "comments"
	Reviews       Connection = "reviews"
	TimelineItems Connection = "timelineItems"
)

// Connections lists every nested connection in the order queries select
// them.
var Connections = []Connection{Labels, Commits, Comments, Reviews, TimelineItems}

const rateLimitFields = `rateLimit { cost remaining resetAt }`

const pullRequestFields = `number title body state isDraft createdAt updatedAt closedAt mergedAt
      baseRefName additions deletions changedFiles authorAssociation
      author { login __typename }`

const actorFields = `author { login __typename }`

// connectionArgs and connectionNodes hold what each connection selects
// beyond first and after.
var (
	connectionArgs = map[Connection]string{
		TimelineItems: `itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, CLOSED_EVENT, REOPENED_EVENT, MERGED_EVENT]`,
	}
	connectionNodes = map[Connection]string{
		Labels:   `name`,
		Commits:  `commit { authoredDate committedDate message }`,
		Comments: `createdAt body ` + actorFields,
		Reviews:  `submittedAt state ` + actorFields,
		// createdAt lives on each event type, so each needs its own fragment.
		TimelineItems: `__typename
          ... on ReadyForReviewEvent { createdAt }
          ... on ConvertToDraftEvent { createdAt }
          ... on HeadRefForcePushedEvent { createdAt }
          ... on ClosedEvent { createdAt }
          ... on ReopenedEvent { createdAt }
          ... on MergedEvent { createdAt }`,
	}
)

func connectionSelection(c Connection, first, after string) string {
	args := "first: " + first
	if after != "" {
		args += ", after: " + after
	}
	if extra := connectionArgs[c]; extra != "" {
		args += ", " + extra
	}
	return fmt.Sprintf("%s(%s) {\n        pageInfo { hasNextPage endCursor }\n        nodes { %s }\n      }", c, args, connectionNodes[c])
}

// PullRequests lists pull requests by most recently updated, each with the
// first $nested nodes of every connection. Variables: owner, name, first,
// after, nested, and optionally states.
var PullRequests = func() Query {
	var b strings.Builder
	b.WriteString(`query PullRequests($owner: String!, $name: String!, $first: Int!, $after: String, $nested: Int!, $states: [PullRequestState!]) {
  ` + rateLimitFields + `
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
      ` + pullRequestFields + `
`)
	for _, c := range Connections {
		b.WriteString("      " + connectionSelection(c, "$nested", "") + "\n")
	}
	b.WriteString("      }\n    }\n  }\n}\n")
	return Query{Name: "PullRequests", Text: b.String()}
}()

// ConnectionPage returns the query for a further page of one pull
// request's connection c. Variables: owner, name, number, first, after.
func ConnectionPage(c Connection) Query {
	name := "PullRequest" + strings.ToUpper(string(c[:1])) + string(c[1:])
	return Query{Name: name, Text: `query ` + name + `($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  ` + rateLimitFields + `
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ` + connectionSelection(c, "$first", "$after") + `
    }
  }
}
`}
}

// Counts asks for the number of pull requests a search matches and the
// number of open pull requests. Variables: owner, name, search.
var Counts = Query{Name: "Counts", Text: `query Counts($owner: String!, $name: String!, $search: String!) {
  ` + rateLimitFields + `
  search(query: $search, type: ISSUE, first: 1) { issueCount }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN) { totalCount }
  }
}
`}

// AuthorBaselines asks for n search counts in one request: alias a<i>
// answers the search in variable q<i>.
func AuthorBaselines(n int) Query {
	var vars, fields strings.Builder
	for i := range n {
		if i > 0 {
			vars.WriteString(", ")
		}
		fmt.Fprintf(&vars, "$q%d: String!", i)
		fmt.Fprintf(&fields, "  a%d: search(query: $q%d, type: ISSUE, first: 1) { issueCount }\n", i, i)
	}
	return Query{Name: "AuthorBaselines", Text: "query AuthorBaselines(" + vars.String() + ") {\n  " +
		rateLimitFields + "\n" + fields.String() + "}\n"}
}
