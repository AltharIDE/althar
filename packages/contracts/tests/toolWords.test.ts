import { describe, expect, it } from 'vitest'

import { plainTitle, toolPhrase, toolWordsOf } from '../src/toolWords'

describe('toolWordsOf', () => {
  it('says Althar’s own tools in plain words, in the tense of how far they are', () => {
    expect(toolWordsOf('mcp__althar__propose_plan')).toBe('Plan the task')
    expect(toolWordsOf('mcp__althar__propose_plan', 'running')).toBe('Planning the task')
    expect(toolWordsOf('mcp__althar__finish_step', 'done')).toBe('Finished the step')
    expect(toolWordsOf('mcp.althar.read_task', 'running')).toBe('Reading the task')
    expect(toolWordsOf('althar.list_tasks')).toBe('List the tasks')
  })

  it('says another server’s tool from its own name', () => {
    expect(toolWordsOf('mcp__linear__list_issues', 'running')).toBe('Listing issues')
    expect(toolWordsOf('mcp__github__createPullRequest', 'done')).toBe('Created pull request')
    expect(toolWordsOf('mcp__x__weird_tool')).toBe('Weird tool')
  })

  it('says a tool Althar’s table lacks as words, never its raw name', () => {
    expect(toolWordsOf('mcp__althar__brand_new_thing')).toBe('Brand new thing')
  })

  it('leaves any other title alone', () => {
    expect(toolWordsOf('Read file.txt')).toBeUndefined()
    expect(plainTitle('npm test')).toBe('npm test')
    expect(plainTitle('mcp__althar__propose_plan')).toBe('Plan the task')
  })

  it('names a server’s tool for a call row', () => {
    expect(toolPhrase('linear', 'save_issue', 'done')).toBe('Saved issue')
  })
})
