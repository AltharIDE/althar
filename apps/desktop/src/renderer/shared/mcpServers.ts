import { Brand } from '@althar/ui'

/*
 * The person's MCP servers as the window marks them: the brand of the host
 * or tracker a server is for, by the name its config gives it, where the
 * name says (github, github-mcp, linear-server). Any other server gets the
 * plug.
 */

const BRANDS: ReadonlyArray<readonly [RegExp, Brand]> = [
  [/github/i, Brand.GitHub],
  [/gitlab/i, Brand.GitLab],
  [/linear/i, Brand.Linear],
  [/jira/i, Brand.Jira],
  [/confluence/i, Brand.Confluence],
  [/atlassian/i, Brand.Atlassian],
  [/bitbucket/i, Brand.Bitbucket],
]

export const serverBrand = (server: string): Brand | undefined => BRANDS.find(([name]) => name.test(server))?.[1]
