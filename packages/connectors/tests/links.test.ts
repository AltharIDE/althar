import { describe, expect, it } from '@effect/vitest'

import { HOSTED, linksIn, newPullRequestLink, parseLink, parseRemote } from '../src/links'

describe('a git remote', () => {
  it.each([
    ['git@github.com:meridian/api.git', 'github.com', ['meridian', 'api']],
    ['https://github.com/meridian/api.git', 'github.com', ['meridian', 'api']],
    ['https://github.com/meridian/api', 'github.com', ['meridian', 'api']],
    ['ssh://git@github.example.com:22/meridian/api.git', 'github.example.com', ['meridian', 'api']],
    ['https://gitlab.com/group/sub/project.git', 'gitlab.com', ['group', 'sub', 'project']],
    ['git@GitLab.com:group/sub/project.git', 'gitlab.com', ['group', 'sub', 'project']],
    ['https://user@bitbucket.org/team/repo.git', 'bitbucket.org', ['team', 'repo']],
  ])('%s is %s, at its path', (remote, host, path) => {
    expect(parseRemote(remote)).toEqual({ host, path })
  })

  it.each(['/Users/you/repo', '../repo', 'file:///tmp/repo.git', 'https://github.com/only', 'not a url://'])('%s is no host', (remote) => {
    expect(parseRemote(remote)).toBeNull()
  })
})

describe('a pasted link', () => {
  it('to a GitHub issue or pull request', () => {
    expect(parseLink('https://github.com/meridian/api/issues/12')).toEqual({
      kind: 'issue',
      product: 'github',
      host: 'github.com',
      ref: 'meridian/api#12',
    })
    expect(parseLink('https://github.com/meridian/api/pull/1206/files')).toEqual({
      kind: 'change',
      product: 'github',
      host: 'github.com',
      path: ['meridian', 'api'],
      number: 1206,
    })
    expect(parseLink('https://github.com/meridian/api/tree/main')).toBeNull()
    expect(parseLink('https://github.com/meridian/api/issues/x')).toBeNull()
  })

  it('to a Linear issue, whatever its slug', () => {
    expect(parseLink('https://linear.app/meridian/issue/mer-231/rate-limit-refunds')).toEqual({
      kind: 'issue',
      product: 'linear',
      host: 'linear.app',
      ref: 'MER-231',
    })
    expect(parseLink('https://linear.app/meridian/project/payments')).toBeNull()
  })

  it('to GitLab, with nested groups', () => {
    expect(parseLink('https://gitlab.com/a/b/c/-/issues/7')).toEqual({
      kind: 'issue',
      product: 'gitlab',
      host: 'gitlab.com',
      ref: 'a/b/c#7',
    })
    expect(parseLink('https://gitlab.com/a/b/-/merge_requests/9')).toEqual({
      kind: 'change',
      product: 'gitlab',
      host: 'gitlab.com',
      path: ['a', 'b'],
      number: 9,
    })
    expect(parseLink('https://gitlab.com/a/b/-/pipelines/9')).toBeNull()
    expect(parseLink('https://gitlab.com/a/-/issues/9')).toBeNull()
  })

  it('to Jira, by its key in the path or the board', () => {
    expect(parseLink('https://meridian.atlassian.net/browse/PAY-12')).toEqual({
      kind: 'issue',
      product: 'jira_cloud',
      host: 'meridian.atlassian.net',
      ref: 'PAY-12',
    })
    expect(parseLink('https://meridian.atlassian.net/jira/software/projects/PAY/boards/1?selectedIssue=PAY-13')).toMatchObject({
      ref: 'PAY-13',
    })
    expect(parseLink('https://jira.meridian.dev/browse/OPS-4', new Map([['jira.meridian.dev', 'jira_dc']]))).toMatchObject({
      product: 'jira_dc',
      ref: 'OPS-4',
    })
    expect(parseLink('https://meridian.atlassian.net/wiki/spaces/X')).toBeNull()
  })

  it('to Trello and Bitbucket', () => {
    expect(parseLink('https://trello.com/c/AbC123/42-fix-refunds')).toEqual({
      kind: 'issue',
      product: 'trello',
      host: 'trello.com',
      ref: 'AbC123',
    })
    expect(parseLink('https://trello.com/b/AbC123/board')).toBeNull()
    expect(parseLink('https://bitbucket.org/team/repo/pull-requests/5')).toEqual({
      kind: 'change',
      product: 'bitbucket_cloud',
      host: 'bitbucket.org',
      path: ['team', 'repo'],
      number: 5,
    })
    expect(
      parseLink(
        'https://git.meridian.dev/projects/PAY/repos/api/pull-requests/8/overview',
        new Map([['git.meridian.dev', 'bitbucket_dc']]),
      ),
    ).toMatchObject({
      path: ['PAY', 'api'],
      number: 8,
    })
    const server = new Map([['meridian.dev', 'bitbucket_dc' as const]])
    expect(parseLink('https://meridian.dev/bitbucket/projects/PAY/repos/api/pull-requests/9', server)).toMatchObject({
      path: ['PAY', 'api'],
      number: 9,
    })
    expect(parseLink('https://meridian.dev/users/dana/repos/scratch/pull-requests/2/diff', server)).toMatchObject({
      path: ['~dana', 'scratch'],
      number: 2,
    })
    expect(parseLink('https://bitbucket.org/team/pull-requests/x')).toBeNull()
  })

  it('on a host no one connected, or not a web link, is nothing', () => {
    expect(parseLink('https://example.com/meridian/api/issues/12')).toBeNull()
    expect(parseLink('ftp://github.com/meridian/api/issues/12')).toBeNull()
    expect(parseLink('not a link')).toBeNull()
  })
})

describe('links in text', () => {
  it('are found once each, without the punctuation after them', () => {
    expect(
      linksIn('See https://linear.app/m/issue/MER-1/x, and (https://github.com/m/a/pull/2). Again: https://linear.app/m/issue/MER-1/x'),
    ).toEqual(['https://linear.app/m/issue/MER-1/x', 'https://github.com/m/a/pull/2'])
  })
})

describe('a new pull request’s page', () => {
  it('is where each host opens one from a branch into its base, from the remote it went to', () => {
    expect(newPullRequestLink('git@github.com:meridian/api.git', 'althar/add-retry', 'main', HOSTED)).toBe(
      'https://github.com/meridian/api/compare/main...althar/add-retry?expand=1',
    )
    expect(newPullRequestLink('https://gitlab.com/team/sub/api.git', 'althar/add-retry', 'main', HOSTED)).toBe(
      'https://gitlab.com/team/sub/api/-/merge_requests/new?merge_request%5Bsource_branch%5D=althar%2Fadd-retry&merge_request%5Btarget_branch%5D=main',
    )
    expect(newPullRequestLink('git@bitbucket.org:team/api.git', 'fix', 'develop', HOSTED)).toBe(
      'https://bitbucket.org/team/api/pull-requests/new?source=fix&dest=develop',
    )
    // A team's own, by its name.
    expect(newPullRequestLink('ssh://git@gitlab.acme.dev:2222/web/app.git', 'fix', 'main', HOSTED)).toMatch(
      /^https:\/\/gitlab\.acme\.dev\/web\/app\/-\/merge_requests\/new\?/,
    )
    expect(newPullRequestLink('https://codeberg.org/me/tool.git', 'fix', 'main', HOSTED)).toBe(
      'https://codeberg.org/me/tool/compare/main...fix',
    )
    expect(newPullRequestLink('https://gitea.home.lan/me/tool.git', 'fix', 'main', HOSTED)).toBe(
      'https://gitea.home.lan/me/tool/compare/main...fix',
    )
    // One that can't be told, or no host at all.
    expect(newPullRequestLink('git@git.example.org:me/tool.git', 'fix', 'main', HOSTED)).toBeNull()
    expect(newPullRequestLink('/srv/git/tool.git', 'fix', 'main', HOSTED)).toBeNull()
  })
})
