import { adfOf, type AdfNode } from '../src/jiraText'

/*
 * Jira's text for jiraText.test.ts and the performance run's jiraText.bench.ts: ADF's builders, real issues' text, a
 * comment as Althar writes one, and text that once made a converter slow.
 */

type Mark = string | { readonly type: string; readonly attrs: Readonly<Record<string, unknown>> }
export const text = (value: string, ...marks: ReadonlyArray<Mark>): AdfNode => ({
  type: 'text',
  text: value,
  ...(marks.length === 0 ? {} : { marks: marks.map((mark) => (typeof mark === 'string' ? { type: mark } : mark)) }),
})
export const link = (href: string) => ({ type: 'link', attrs: { href } })
export const paragraph = (...content: ReadonlyArray<AdfNode>): AdfNode => ({ type: 'paragraph', content })
export const item = (...content: ReadonlyArray<AdfNode>): AdfNode => ({ type: 'listItem', content })
export const doc = (...content: ReadonlyArray<AdfNode>): AdfNode => ({ type: 'doc', content })
export const lines = (...all: ReadonlyArray<string>) => all.join('\n')

/** KAFKA-21232's description, trimmed. */
export const KAFKA_21232 = [
  '*Action points (dependencies version upgrades):*',
  ' * Apache Ldap Api: 1.0.2 \\-\\-> -_*2.1.9*_- {color:#de350b}*2.0.2* {color}({_}version compatible with Apache DS {{2.0.0.AM26}}{_})',
  ' * Apache directory server: 2.0.0-M24 --> 2.0.0.AM26',
  '',
  '*Rationale:*',
  ' * Apache Ldap api:',
  ' ** version -2.1.9 is published in September 2026.- 2.0.2 is published in May 2021.',
  ' ** [https://directory.apache.org/api/migration-guide.html]',
  ' ** note: single artefact ({*}org.apache.directory.server:apacheds-protocol-kerberos){*} latest version is {*}2.0.0.AM26{*}:',
  ' *** [https://lists.apache.org/thread/7vkkn3bsd6w018j1pdcxbvdo2qx305fn] *[ANNOUNCE] Apache DS 2.0.0.AM27 released*',
  '{quote}The Kerberos subsystem has been removed from the server, as Apache Kerby is already providing a maintained and updated Kerberos server.',
  '{quote}',
  ' *** !image-2026-10-06-16-45-13-900.png!',
  '',
  ' ',
].join('\r\n')

/** A comment as Althar writes one. */
export const COMMENT = lines(
  '## Opened a draft pull request',
  '',
  '**Althar** opened [PR #12](https://github.com/meridian/api/pull/12) for _MER-231_, ~~not~~ with `rate_limit`.',
  'Second line, with https://example.com/a_b.',
  '',
  '1. First step',
  '   - nested one',
  '2. Second step',
  '',
  '> Quoted',
  '',
  '```ts',
  'const a = 1 * 2',
  '```',
  '',
  '---',
)

const n = 50_000
/** Text that once made a converter search again from each of many openers, backtrack over a run, or nest without end. */
export const odd: Readonly<Record<string, string>> = {
  stars: '*'.repeat(n),
  'stars and spaces': '*a '.repeat(n / 3),
  dashes: '-a '.repeat(n / 3),
  'a lone backtick': `\`${' x'.repeat(n / 2)}`,
  'a padded code span': `\` ${'a '.repeat(n / 2)}b\``,
  'backtick runs of every length': Array.from({ length: 300 }, (_, index) => '`'.repeat(index + 1)).join(' '),
  brackets: '['.repeat(n),
  'brackets and pipes': '[a|'.repeat(n / 3),
  'mentions never closed': '[~a'.repeat(n / 3),
  'links never closed': '[a]('.repeat(n / 4),
  'autolinks never closed': '<http:'.repeat(n / 6),
  'a code macro never closed': `{code:${'x'.repeat(n)}`,
  'code macros never closed': '{code:a}'.repeat(n / 8),
  'monospace never closed': '{{a'.repeat(n / 3),
  'macros never closed': '{a:'.repeat(n / 3),
  'every mark': '_*~'.repeat(n / 3),
  'emphasis nested deep': `${'*_'.repeat(n / 4)}x${'_*'.repeat(n / 4)}`,
  'quotes nested deep': '>'.repeat(n),
  'lists nested deep': Array.from({ length: 300 }, (_, index) => `${' '.repeat(index)}- item`).join('\n'),
  'a heading of spaces': `#${' '.repeat(n)}x`,
  'spaces before a break': `${' '.repeat(n)}x\ny`,
  'blank lines in a list': `- a${'\n'.repeat(n)}x`,
  'breaks in a fence': `\`\`\`\nx${'\n'.repeat(n)}y\n\`\`\``,
  fences: '```\nx\n```\n'.repeat(n / 10),
  'a long table': '|a|b|\n'.repeat(n / 6),
  'a long line': 'word '.repeat(n / 5),
}
/** A long ordinary document: real issues' text, and comments as Althar writes them, many times over. */
export const ordinary = `${KAFKA_21232}\n\n${COMMENT}\n\n`.repeat(40)
/** ADF documents nested deeper and wider than any editor makes. */
export const nest = (depth: number, wrap: (inner: AdfNode) => AdfNode) => {
  let node: AdfNode = paragraph(text('deep'))
  for (let level = 0; level < depth; level += 1) node = wrap(node)
  return doc(node)
}
export const documents: Readonly<Record<string, AdfNode>> = {
  'lists nested deep': nest(20_000, (inner) => ({ type: 'bulletList', content: [item(inner)] })),
  'quotes nested deep': nest(20_000, (inner) => ({ type: 'blockquote', content: [inner] })),
  'marks on every letter': doc(paragraph(...Array.from({ length: 20_000 }, () => text('x', 'strong')))),
  'an unknown node with many children': doc(paragraph({ type: 'unknown', content: Array.from({ length: 200_000 }, () => text('x')) })),
  'backticks in code': doc(paragraph(text('` '.repeat(n), 'code'))),
  'breaks in a code block': doc({ type: 'codeBlock', content: [text(`x${'\n'.repeat(n)}y`)] }),
  'spaces in a cell': doc({
    type: 'table',
    content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text(`${' '.repeat(n)}x`))] }] }],
  }),
  'an ordinary document': adfOf(ordinary),
}
