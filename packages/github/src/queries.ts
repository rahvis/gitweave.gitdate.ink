/**
 * One deeply-nested query replaces ~5 REST calls per PR.
 *
 * At PostHog's volume (15,061 merged PRs / 90d) the REST shape would be
 * ~60,000 requests (≈12h at 5,000/hr). This shape is ~300 requests.
 *
 * `reviewThreads.isOutdated` is the load-bearing field: GitHub sets it when
 * the diff hunk a review comment anchored to was subsequently changed —
 * i.e. the review actually moved the code. That is our consequential-review
 * signal, and it is why we pay for the nested connection.
 */
export const MERGED_PRS_QUERY = /* GraphQL */ `
  query MergedPRs($owner: String!, $name: String!, $pageSize: Int!, $cursor: String) {
    rateLimit { limit cost remaining resetAt nodeCount }
    repository(owner: $owner, name: $name) {
      pullRequests(
        states: [MERGED]
        first: $pageSize
        after: $cursor
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          title
          body
          url
          createdAt
          mergedAt
          closedAt
          state
          additions
          deletions
          changedFiles
          headRefName
          author { login __typename }
          mergedBy { login __typename }
          labels(first: 15) { nodes { name } }
          files(first: 100) { nodes { path additions deletions } }
          commits(first: 30) {
            nodes {
              commit {
                oid
                committedDate
                message
                author { user { login } }
              }
            }
          }
          reviews(first: 25) {
            nodes {
              author { login __typename }
              state
              submittedAt
              body
            }
          }
          reviewThreads(first: 25) {
            nodes {
              id
              isResolved
              isOutdated
              path
              comments(first: 1) {
                totalCount
                nodes { author { login __typename } createdAt }
              }
            }
          }
          timelineItems(first: 20, itemTypes: [REVIEW_REQUESTED_EVENT]) {
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  ... on User { login }
                  ... on Team { name }
                }
              }
            }
          }
          comments(first: 20) {
            nodes { author { login __typename } createdAt body }
          }
        }
      }
    }
  }
`;

export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer { viewer { login } rateLimit { limit remaining resetAt } }
`;
