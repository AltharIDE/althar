import { describe as group, expect, it } from 'vite-plus/test'

import { FALLBACK_TITLE, describe, titleOf } from '../src/describe'
import { type Report, readReport } from '../src/report'
import { INSTALL_ID, TEXT, sampleReport } from './support'

/*
 * The issue's title and description: the first line as the title, cut
 * cleanly; the text in full, then one plain line per fact; and no line at
 * all for a part the report doesn't have.
 */

const report = (changes: Partial<Report> = {}): Report => ({ ...readReport(sampleReport()), ...changes })
const none = { screenshot: null, logs: null }

group('the title', () => {
  it('is the first line with words in it, its spacing tidied', () => {
    expect(titleOf('\n  \n  Review   hangs\tafter the first file  \nMore detail')).toBe('Review hangs after the first file')
  })

  it('keeps a line of 80 characters whole', () => {
    const line = 'x'.repeat(80)
    expect(titleOf(line)).toBe(line)
  })

  it('cuts a longer line at a word, at most 80 characters with the ellipsis', () => {
    const line = 'When I open a task that an agent is still working on the thread jumps back to the top every few seconds'
    const title = titleOf(line)
    expect(title).toBe('When I open a task that an agent is still working on the thread jumps back to…')
    expect(Array.from(title).length).toBeLessThanOrEqual(80)
  })

  it('cuts mid-word when a word boundary would lose more than half', () => {
    const title = titleOf(`Error ${'x'.repeat(100)}`)
    expect(title).toBe(`Error ${'x'.repeat(73)}…`)
    expect(Array.from(title).length).toBe(80)
  })

  it('counts characters, not UTF-16 units, so it never splits one', () => {
    const title = titleOf('🙂'.repeat(100))
    expect(Array.from(title)).toEqual([...Array.from({ length: 79 }, () => '🙂'), '…'])
  })

  it('falls back when no line has words', () => {
    expect(titleOf(' \n\t\n')).toBe(FALLBACK_TITLE)
  })
})

group('the description', () => {
  it('has the text in full, a rule, and one line per fact', () => {
    expect(describe(report(), none)).toBe(
      [
        TEXT,
        '---',
        [
          '- App 0.4.2 on macOS 26.5 (arm64), Electron 44.5.0',
          '- Screen: task, project `proj_7Hq2`, task `task_19xk`, thread `thr_a81`',
          '- About: Stuck: Implement',
          `- Install: \`${INSTALL_ID}\``,
          '- Reply to: ada@example.com',
          '- Claude Code 2.1.263, adapter 0.88.0, signed in',
          '- Codex, not installed',
          '- 18 migrations, the last 0018\\_questions',
        ].join('\n'),
        'Last errors:',
        '```text\n2026-10-11T09:12:03Z error turn failed: ProviderTimeout after 600s\n```',
      ].join('\n\n'),
    )
  })

  it('leaves out every part the report does not have', () => {
    const bare = report({
      email: null,
      context: { screen: 'home', projectId: null, taskId: null, threadId: null, about: null },
      agents: [],
      migrations: { count: 1, last: null },
      errors: [],
    })
    expect(describe(bare, none)).toBe(
      [
        TEXT,
        '---',
        ['- App 0.4.2 on macOS 26.5 (arm64), Electron 44.5.0', '- Screen: home', `- Install: \`${INSTALL_ID}\``, '- 1 migration'].join(
          '\n',
        ),
      ].join('\n\n'),
    )
  })

  it('embeds the screenshot and links the logs, with brackets in their addresses encoded', () => {
    const text = describe(report(), {
      screenshot: 'https://uploads.linear.app/a/shot (1).png',
      logs: 'https://uploads.linear.app/b/logs.txt',
    })
    expect(text).toContain('![Screenshot](https://uploads.linear.app/a/shot%20%281%29.png)')
    expect(text).toContain('[logs.txt](https://uploads.linear.app/b/logs.txt)')
    expect(text.indexOf('![Screenshot]')).toBeLessThan(text.indexOf('[logs.txt]'))
    expect(text.indexOf('[logs.txt]')).toBeLessThan(text.indexOf('Last errors:'))
  })

  it('escapes what the app sent, so it reads as text', () => {
    const text = describe(
      report({
        agents: [{ id: 'evil', name: '[Claude](https://evil.test) <img>', version: '*1*', adapter: null, signIn: 'unknown' }],
      }),
      none,
    )
    expect(text).toContain('- \\[Claude\\](https://evil.test) \\<img\\> \\*1\\*, sign-in unknown')
  })

  it('fences the errors with more backticks than any run inside them', () => {
    const text = describe(report({ errors: ['before ``` after', 'next'] }), none)
    expect(text).toContain('````text\nbefore ``` after\nnext\n````')
  })
})
