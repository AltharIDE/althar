import { describe, expect, it } from 'vitest'

import { text } from '../src/renderer/features/connections/ConnectFlow'

/* What connecting a tracker says of each one, in its own words: a Trello board's cards, Linear's teams, ClickUp's tasks. */

describe('connecting a tracker, in its own words', () => {
  it('names what each tracker keeps, and how many of them a token reaches', () => {
    expect([text.needs.read('trello'), text.needs.read('linear'), text.needs.read('clickup'), text.needs.read('jira_cloud')]).toEqual([
      'Reads your boards',
      'Reads your workspace’s issues',
      'Reads your workspaces’ tasks',
      'Reads its issues',
    ])
    expect([text.needs.comment('trello'), text.needs.comment('clickup'), text.needs.comment('linear')]).toEqual([
      'Comments on cards',
      'Comments on tasks',
      'Comments on issues',
    ])
    expect([text.needs.move('trello'), text.needs.move('linear'), text.needs.move('clickup'), text.needs.move('jira_dc')]).toEqual([
      'Moves cards between lists',
      'Moves an issue’s status',
      'Moves a task’s status',
      'Moves them through their workflow',
    ])
    expect([text.counted('trello', 1), text.counted('linear', 2), text.counted('clickup', 3), text.counted('jira_cloud', 1)]).toEqual([
      '1 board',
      '2 teams',
      '3 workspaces',
      '1 project',
    ])
  })

  it('says what a pasted token looks like for each service', () => {
    expect(text.looksLike('Jira', 'jira_cloud')).toBe('An Atlassian token')
    expect(text.looksLike('Linear', 'linear')).toBe('A Linear key')
    expect(text.looksLike('ClickUp', 'clickup')).toBe('A ClickUp token')
    expect(text.looksLike('GitLab', 'gitlab')).toBe('A GitLab token')
  })

  it('names a code host’s account by where it is', () => {
    expect(text.needs.account('bitbucket_cloud', 'Bitbucket', true)).toBe('Your Atlassian account')
    expect(text.needs.account('github', 'GitHub', true)).toBe('Your GitHub account')
    expect(text.needs.account('gitlab', 'GitLab', false)).toBe('Your account there')
  })
})
