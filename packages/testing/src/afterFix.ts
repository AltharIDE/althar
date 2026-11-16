/** Whether a failing commit contains the change that closed its issue. Unknown provenance keeps the failure actionable. */
export const afterFix = (
  gh: (...args: ReadonlyArray<string>) => string,
  repository: string,
  number: number,
  sha: string | undefined,
): boolean => {
  if (!sha) return true
  const [owner, name] = repository.split('/')
  const result = JSON.parse(
    gh(
      'api',
      'graphql',
      '-f',
      'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){timelineItems(last:1,itemTypes:[CLOSED_EVENT]){nodes{... on ClosedEvent{closer{... on PullRequest{mergeCommit{oid}} ... on Commit{oid}}}}}}}}',
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${number}`,
    ),
  ) as {
    data: {
      repository: {
        issue: { timelineItems: { nodes: ReadonlyArray<{ closer: { mergeCommit?: { oid: string } | null; oid?: string } | null }> } }
      }
    }
  }
  const closer = result.data.repository.issue.timelineItems.nodes[0]?.closer
  const fixed = closer?.mergeCommit?.oid ?? closer?.oid
  if (!fixed) return true
  const status = gh('api', `repos/${repository}/compare/${fixed}...${sha}`, '--jq', '.status')
  return status !== 'behind' && status !== 'diverged'
}
