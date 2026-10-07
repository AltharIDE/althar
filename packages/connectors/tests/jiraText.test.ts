import { assert, describe, it } from '@effect/vitest'

import { adfOf, type AdfNode, markdownOfAdf, markdownOfWiki, wikiOf } from '../src/jiraText'

/*
 * Jira's text both ways. What is read comes from real issues where it can,
 * trimmed: ADF from hibernate.atlassian.net (Jira Cloud), wiki markup from
 * issues.apache.org/jira (Data Center).
 */

type Mark = string | { readonly type: string; readonly attrs: Readonly<Record<string, unknown>> }
const text = (value: string, ...marks: ReadonlyArray<Mark>): AdfNode => ({
  type: 'text',
  text: value,
  ...(marks.length === 0 ? {} : { marks: marks.map((mark) => (typeof mark === 'string' ? { type: mark } : mark)) }),
})
const link = (href: string) => ({ type: 'link', attrs: { href } })
const paragraph = (...content: ReadonlyArray<AdfNode>): AdfNode => ({ type: 'paragraph', content })
const item = (...content: ReadonlyArray<AdfNode>): AdfNode => ({ type: 'listItem', content })
const doc = (...content: ReadonlyArray<AdfNode>): AdfNode => ({ type: 'doc', content })
const lines = (...all: ReadonlyArray<string>) => all.join('\n')

describe('ADF, read as Markdown', () => {
  it('keeps marks, with their spaces outside them', () => {
    assert.strictEqual(
      markdownOfAdf(
        doc(
          paragraph(
            text('bold ', 'strong'),
            text('both', 'strong', 'em'),
            text(' '),
            text('gone', 'strike'),
            text(' '),
            text('a`b', 'code'),
            text(' '),
            text('Althar', link('https://althar.dev')),
            text(' '),
            text('https://althar.dev', link('https://althar.dev')),
            text(' '),
            text('x', 'code', link('https://x.dev')),
            text('u', 'underline'),
            text(' ', 'strong'),
          ),
        ),
      ),
      '**bold** ***both*** ~~gone~~ `` a`b `` [Althar](https://althar.dev) <https://althar.dev> [`x`](https://x.dev)u ',
    )
  })

  it('says who is mentioned, and keeps what else sits in a line as its text', () => {
    assert.strictEqual(
      markdownOfAdf(
        doc(
          paragraph(
            { type: 'mention', attrs: { id: '557058:ea49f1db-ef91-4d96-8f3a-a939be8d2b1c', text: '@Chris Cranford', accessLevel: '' } },
            text(' and '),
            { type: 'mention', attrs: { id: '557058:71e3' } },
            text(' and '),
            { type: 'mention', attrs: { text: 'Guillaume' } },
            { type: 'mention' },
            { type: 'hardBreak' },
            { type: 'emoji', attrs: { shortName: ':stuck_out_tongue:', id: '1f61b', text: '😛' }, marks: [{ type: 'code' }] },
            { type: 'emoji', attrs: { shortName: ':custom:' } },
            text(' '),
            { type: 'inlineCard', attrs: { url: 'https://github.com/locationtech/jts/issues/799', localId: 'cb4915841ad2' } },
            text(' '),
            { type: 'date', attrs: { timestamp: '1759795200000' } },
            { type: 'date', attrs: {} },
            text(' '),
            { type: 'status', attrs: { text: 'IN REVIEW', color: 'blue' } },
            { type: 'placeholder', attrs: { text: ' here' } },
            { type: 'unknown' },
          ),
        ),
      ),
      lines(
        '@Chris Cranford and @557058:71e3 and @Guillaume@  ',
        '😛:custom: https://github.com/locationtech/jts/issues/799 2025-10-07 IN REVIEW here',
      ),
    )
  })

  it('lists, nested, numbered from where they start, and ticked', () => {
    const tasks = (state: string, value: string) => ({ type: 'taskItem', attrs: { localId: 'a', state }, content: [text(value)] })
    assert.strictEqual(
      markdownOfAdf(
        doc(
          {
            type: 'bulletList',
            content: [
              item(paragraph(text('one')), {
                type: 'orderedList',
                attrs: { order: 3 },
                content: [
                  item(paragraph(text('three'))),
                  item(paragraph(text('four')), { type: 'codeBlock', content: [text('code\nmore')] }),
                ],
              }),
              item(paragraph(text('two')), paragraph(), paragraph(text('second paragraph'))),
              { type: 'listItem' },
            ],
          },
          { type: 'orderedList', content: [item(paragraph(text('first')))] },
          {
            type: 'taskList',
            content: [tasks('DONE', 'done'), tasks('TODO', 'to do'), { type: 'taskList', content: [tasks('TODO', 'nested')] }],
          },
          { type: 'decisionList', content: [{ type: 'decisionItem', attrs: { state: 'DECIDED' }, content: [text('decided')] }] },
        ),
      ),
      lines(
        '- one',
        '  3. three',
        '  4. four',
        '',
        '     ```',
        '     code',
        '     more',
        '     ```',
        '- two',
        '',
        '  second paragraph',
        '- ',
        '',
        '1. first',
        '',
        '- [x] done',
        '- [ ] to do',
        '  - [ ] nested',
        '',
        '- [x] decided',
      ),
    )
  })

  it('headings, quotes and code, and what holds blocks of its own', () => {
    assert.strictEqual(
      markdownOfAdf(
        doc(
          { type: 'heading', attrs: { level: 9 }, content: [text('deep')] },
          { type: 'heading', content: [text('none')] },
          { type: 'blockquote', content: [paragraph(text('quoted')), paragraph(text('again'))] },
          { type: 'codeBlock', attrs: { language: 'markdown' }, content: [text('```js\r\nx\r\n```\r\n')] },
          { type: 'panel', attrs: { panelType: 'info' }, content: [paragraph(text('in a panel'))] },
          { type: 'expand', attrs: { title: 'More' }, content: [paragraph(text('inside'))] },
          { type: 'expand', attrs: { title: '' }, content: [paragraph(text('untitled'))] },
          {
            type: 'mediaSingle',
            attrs: { layout: 'center' },
            content: [{ type: 'media', attrs: { type: 'file', id: 'abc', collection: '' } }],
          },
          { type: 'mediaSingle', content: [{ type: 'media', attrs: { type: 'file', id: 'def', alt: 'screenshot.png' } }] },
          paragraph(),
          { type: 'table', content: [] },
          { type: 'rule' },
        ),
      ),
      lines(
        '###### deep',
        '',
        '# none',
        '',
        '> quoted',
        '>',
        '> again',
        '',
        '````markdown',
        '```js',
        'x',
        '```',
        '````',
        '',
        'in a panel',
        '',
        '**More**',
        '',
        'inside',
        '',
        'untitled',
        '',
        'screenshot.png',
        '',
        '---',
      ),
    )
  })

  it('a table, its first row the header', () => {
    // HV-2228, trimmed.
    const cell = (type: string, ...content: ReadonlyArray<AdfNode>) => ({
      type,
      attrs: { colwidth: [48], background: 'transparent' },
      content,
    })
    assert.strictEqual(
      markdownOfAdf(
        doc({
          type: 'table',
          attrs: { isNumberColumnEnabled: false, layout: 'center', localId: '99d922d2-85af-43fc-b908-8b4471d7c100' },
          content: [
            {
              type: 'tableRow',
              content: [
                cell('tableHeader', paragraph(text('#'))),
                cell('tableHeader', paragraph(text('Constraint'))),
                cell('tableHeader', paragraph(text('Done'))),
              ],
            },
            {
              type: 'tableRow',
              content: [
                cell('tableCell', paragraph(text('1'))),
                cell('tableCell', paragraph(text('@StartsWith', 'code'), text(' / a|b')), paragraph(text('two lines'))),
                cell(
                  'tableCell',
                  paragraph({ type: 'emoji', attrs: { shortName: ':white_check_mark:', id: '2705', text: '✅' } }, text(' ')),
                ),
              ],
            },
            { type: 'tableRow', content: [cell('tableCell', paragraph(text('2'))), { type: 'tableCell' }] },
            { type: 'tableRow' },
          ],
        }),
      ),
      lines(
        '| # | Constraint | Done |',
        '| --- | --- | --- |',
        '| 1 | `@StartsWith` / a\\|b two lines | ✅ |',
        '| 2 |  |  |',
        '|  |  |  |',
      ),
    )
  })

  it('a real comment, and a real quote', () => {
    // From HHH-12893 and HHH-9270.
    assert.strictEqual(
      markdownOfAdf({
        version: 1,
        type: 'doc',
        content: [
          paragraph(
            { type: 'mention', attrs: { id: '557058:71e31052-f0d7-46e3-a9d7-8b9acd6998d8', text: '@Guillaume Smet', accessLevel: '' } },
            text(', perhaps; however what I don’t yet understand is why this is a problem when using schema tooling.'),
          ),
          {
            type: 'blockquote',
            content: [
              paragraph(
                text(
                  'The persistence provider is permitted to fetch additional entity state beyond that specified by a fetch graph or load graph.',
                  'strong',
                ),
                text('  It is required, however, that the persistence provider fetch all state specified by the fetch or load graph.'),
              ),
            ],
          },
          { type: 'heading', attrs: { level: 2, localId: '26a2758e6278' }, content: [text('Original Description')] },
        ],
      } as AdfNode),
      lines(
        '@Guillaume Smet, perhaps; however what I don’t yet understand is why this is a problem when using schema tooling.',
        '',
        '> **The persistence provider is permitted to fetch additional entity state beyond that specified by a fetch graph or load graph.**  It is required, however, that the persistence provider fetch all state specified by the fetch or load graph.',
        '',
        '## Original Description',
      ),
    )
  })

  it('an empty document as nothing', () => {
    assert.strictEqual(markdownOfAdf(doc()), '')
  })
})

/** KAFKA-21232's description, trimmed. */
const KAFKA_21232 = [
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

describe('wiki markup, read as Markdown', () => {
  it('the editor’s braced marks, colours, strikes and nested lists (KAFKA-21232)', () => {
    assert.strictEqual(
      markdownOfWiki(KAFKA_21232),
      lines(
        '**Action points (dependencies version upgrades):**',
        '- Apache Ldap Api: 1.0.2 --> ~~_**2.1.9**_~~ **2.0.2** (_version compatible with Apache DS `2.0.0.AM26`_)',
        '- Apache directory server: 2.0.0-M24 --> 2.0.0.AM26',
        '',
        '**Rationale:**',
        '- Apache Ldap api:',
        '  - version ~~2.1.9 is published in September 2026.~~ 2.0.2 is published in May 2021.',
        '  - <https://directory.apache.org/api/migration-guide.html>',
        '  - note: single artefact (**org.apache.directory.server:apacheds-protocol-kerberos)** latest version is **2.0.0.AM26**:',
        '    - <https://lists.apache.org/thread/7vkkn3bsd6w018j1pdcxbvdo2qx305fn> **[ANNOUNCE] Apache DS 2.0.0.AM27 released**',
        '',
        '> The Kerberos subsystem has been removed from the server, as Apache Kerby is already providing a maintained and updated Kerberos server.',
        '',
        '- image-2026-10-06-16-45-13-900.png',
      ),
    )
  })

  it('a panel by its title, an image by its name, and emoticons as they are (KAFKA-20943)', () => {
    assert.strictEqual(
      markdownOfWiki(
        [
          '(flag) *Prologue/possible pitfall:* ',
          " * KAFKA-19707 Develocity Gradle plugin version can't be upgraded",
          ' * [https://github.com/gradle/gradle/issues/34994#issuecomment-3293730852]',
          ' ',
          '!screenshot-1.png|thumbnail!',
          '',
          '{panel:title=Addendum: last two related plugins version changes: |borderStyle=dashed|borderColor=#cccccc}',
          ' * Jan 2025: [https://github.com/apache/kafka/pull/18505]',
          '{panel}',
        ].join('\r\n'),
      ),
      lines(
        '(flag) **Prologue/possible pitfall:**',
        "- KAFKA-19707 Develocity Gradle plugin version can't be upgraded",
        '- <https://github.com/gradle/gradle/issues/34994#issuecomment-3293730852>',
        '',
        'screenshot-1.png',
        '',
        '**Addendum: last two related plugins version changes:**',
        '- Jan 2025: <https://github.com/apache/kafka/pull/18505>',
      ),
    )
  })

  it('tables, with or without a header, and links with their labels (KAFKA-20728)', () => {
    assert.strictEqual(
      markdownOfWiki(
        [
          'h2. NIST Standards Reference',
          '',
          '||Standard||Algorithm||Purpose||',
          '|FIPS 203|ML-KEM (Kyber)|Key Encapsulation Mechanism|',
          '',
          '|no|header',
          'h2. References',
          '',
          '* [France ANSSI 2027 Deadline|https://gizmodo.com/the-quantum-threat-to-encryption-is-coming-france-just-set-a-2027-deadline-2000773650]',
          '* [JEP 527 — Post-Quantum Key Exchange for TLS 1.3|https://openjdk.org/jeps/527]',
        ].join('\r\n'),
      ),
      lines(
        '## NIST Standards Reference',
        '',
        '| Standard | Algorithm | Purpose |',
        '| --- | --- | --- |',
        '| FIPS 203 | ML-KEM (Kyber) | Key Encapsulation Mechanism |',
        '',
        '| no | header |',
        '| --- | --- |',
        '',
        '## References',
        '',
        '- [France ANSSI 2027 Deadline](https://gizmodo.com/the-quantum-threat-to-encryption-is-coming-france-just-set-a-2027-deadline-2000773650)',
        '- [JEP 527 — Post-Quantum Key Exchange for TLS 1.3](https://openjdk.org/jeps/527)',
      ),
    )
  })

  it('noformat as a plain code block (KAFKA-21172)', () => {
    assert.strictEqual(
      markdownOfWiki(
        [
          'The data loss happens in every run; {{StreamsUpgradeTest.test_app_upgrade}} fails only when the extra restores take longer than 60 s:',
          '',
          '{noformat}',
          "TimeoutError: Did expect to read 'SMOKE-TEST-CLIENT-STARTED' from ducker@ducker51",
          '{noformat}',
          '',
          '* [apache/kafka#18830|https://github.com/apache/kafka/pull/18830] moved the driver timestamps',
        ].join('\r\n'),
      ),
      lines(
        'The data loss happens in every run; `StreamsUpgradeTest.test_app_upgrade` fails only when the extra restores take longer than 60 s:',
        '',
        '```',
        "TimeoutError: Did expect to read 'SMOKE-TEST-CLIENT-STARTED' from ducker@ducker51",
        '```',
        '',
        '- [apache/kafka#18830](https://github.com/apache/kafka/pull/18830) moved the driver timestamps',
      ),
    )
  })

  it('headings, quotes, rules, mentions, links of every kind, escapes and code', () => {
    assert.strictEqual(
      markdownOfWiki(
        lines(
          'h1. Title',
          'h6.Tight',
          'bq. A quote with *bold*',
          '----',
          'Ask [~kirktrue], see [the docs|#anchor], [|https://kafka.apache.org], [mailto:dev@kafka.apache.org], [ANNOUNCE] and https://example.com/-x-/a_b_c.',
          'A link with bold text: [*Kafka* site|https://kafka.apache.org], an escaped \\* star, \\[bracket\\] and \\{code\\}.',
          'Code in a line {code}x = 1{code} carries on.',
          '{code:title=Bar.java|borderStyle=solid}',
          'class Bar {}',
          '{code}',
          '{code:xml}<a/>{code}',
          'line with {anchor:here} an anchor',
          '{quote}',
          'outer {quote}',
          '{quote}',
          '{unknownmacro}',
          'a + b * c - d, -x- and well-known, *a* and 2*3*4',
        ),
      ),
      lines(
        '# Title',
        '',
        '###### Tight',
        '',
        '> A quote with **bold**',
        '',
        '---',
        '',
        'Ask @kirktrue, see the docs, [https://kafka.apache.org](https://kafka.apache.org), <mailto:dev@kafka.apache.org>, [ANNOUNCE] and https://example.com/-x-/a_b_c.  ',
        'A link with bold text: [**Kafka** site](https://kafka.apache.org), an escaped \\* star, \\[bracket\\] and {code}.  ',
        'Code in a line',
        '',
        '```',
        'x = 1',
        '```',
        '',
        'carries on.',
        '',
        '```',
        'class Bar {}',
        '```',
        '',
        '```xml',
        '<a/>',
        '```',
        '',
        'line with  an anchor',
        '',
        '> outer',
        '',
        'a + b * c - d, ~~x~~ and well-known, **a** and 2*3*4',
      ),
    )
  })

  it('lists of every kind, a line that carries on an item, and a list straight after a paragraph', () => {
    assert.strictEqual(
      markdownOfWiki(
        lines(
          '- dash item',
          '# one',
          '#* one a',
          '#*# one a i',
          '# two',
          'carries on',
          'and on',
          '',
          'a paragraph',
          '* straight after',
          '{color:red}{color}',
          'the end',
        ),
      ),
      lines(
        '- dash item',
        '1. one',
        '   - one a',
        '     1. one a i',
        '1. two  ',
        '   carries on  ',
        '   and on',
        '',
        'a paragraph',
        '- straight after',
        '',
        'the end',
      ),
    )
  })

  it('nothing as nothing', () => {
    assert.strictEqual(markdownOfWiki(''), '')
  })
})

/** A comment as Althar writes one. */
const COMMENT = lines(
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

describe('Markdown, written as ADF for Jira Cloud', () => {
  it('a comment as Althar writes one', () => {
    assert.deepStrictEqual(adfOf(COMMENT), {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Opened a draft pull request')] },
        paragraph(
          text('Althar', 'strong'),
          text(' opened '),
          text('PR #12', link('https://github.com/meridian/api/pull/12')),
          text(' for '),
          text('MER-231', 'em'),
          text(', '),
          text('not', 'strike'),
          text(' with '),
          text('rate_limit', 'code'),
          text('.'),
          { type: 'hardBreak' },
          text('Second line, with '),
          text('https://example.com/a_b', link('https://example.com/a_b')),
          text('.'),
        ),
        {
          type: 'orderedList',
          attrs: { order: 1 },
          content: [
            item(paragraph(text('First step')), { type: 'bulletList', content: [item(paragraph(text('nested one')))] }),
            item(paragraph(text('Second step'))),
          ],
        },
        { type: 'blockquote', content: [paragraph(text('Quoted'))] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1 * 2')] },
        { type: 'rule' },
      ],
    })
  })

  it('emphasis, escapes and code spans', () => {
    assert.deepStrictEqual(
      adfOf('**bold** __also__ *em* _em_ ~~gone~~ ~not~ snake_case_name 2*3*4 ***both*** *a `x*` b* **unclosed').content,
      [
        paragraph(
          text('bold', 'strong'),
          text(' '),
          text('also', 'strong'),
          text(' '),
          text('em', 'em'),
          text(' '),
          text('em', 'em'),
          text(' '),
          text('gone', 'strike'),
          text(' ~not~ snake_case_name 2'),
          text('3', 'em'),
          text('4 '),
          text('both', 'strong', 'em'),
          text(' '),
          text('a ', 'em'),
          // Code takes no mark but a link.
          text('x*', 'code'),
          text(' b', 'em'),
          text(' **unclosed'),
        ),
      ],
    )
    assert.deepStrictEqual(adfOf('a \\*b\\* `code` ``a`b`` ` padded ` `x and a lone ` \\').content, [
      paragraph(
        text('a *b* '),
        text('code', 'code'),
        text(' '),
        text('a`b', 'code'),
        text(' '),
        text('padded', 'code'),
        text(' '),
        text('x and a lone ', 'code'),
        text(' \\'),
      ),
    ])
    assert.deepStrictEqual(adfOf('*a **b** c* _a_b c_ **a __b__ c** a lone ` here [a\\]b](https://x.dev) [open').content, [
      paragraph(
        text('a ', 'em'),
        text('b', 'em', 'strong'),
        text(' c', 'em'),
        text(' '),
        text('a_b c', 'em'),
        text(' '),
        text('a ', 'strong'),
        text('b', 'strong'),
        text(' c', 'strong'),
        text(' a lone ` here '),
        text('a]b', link('https://x.dev')),
        text(' [open'),
      ),
    ])
  })

  it('links of every kind, and none within a link', () => {
    assert.deepStrictEqual(
      adfOf(
        '[Althar](https://althar.dev "Althar") [x](<https://x.dev/a b>) <https://y.dev> ok(https://w.dev) word:https://v.dev xhttps://no.dev [nope] [**bold** link](https://b.dev) [`c`](https://c.dev) [https://x.dev](https://x.dev)',
      ).content,
      [
        paragraph(
          text('Althar', link('https://althar.dev')),
          text(' '),
          text('x', link('https://x.dev/a b')),
          text(' '),
          text('https://y.dev', link('https://y.dev')),
          text(' ok('),
          text('https://w.dev', link('https://w.dev')),
          text(') word:'),
          text('https://v.dev', link('https://v.dev')),
          text(' xhttps://no.dev [nope] '),
          text('bold', link('https://b.dev'), 'strong'),
          text(' link', link('https://b.dev')),
          text(' '),
          text('c', 'code', link('https://c.dev')),
          text(' '),
          text('https://x.dev', link('https://x.dev')),
        ),
      ],
    )
  })

  it('every line its own, however it was broken', () => {
    assert.deepStrictEqual(adfOf('one  \ntwo\\\nthree\r\nfour').content, [
      paragraph(text('one'), { type: 'hardBreak' }, text('two'), { type: 'hardBreak' }, text('three'), { type: 'hardBreak' }, text('four')),
    ])
  })

  it('headings and code blocks, closed or not', () => {
    assert.deepStrictEqual(
      adfOf(lines('# One #', '###### Six', '####### Seven', '~~~', 'plain', '~~~', '```', '```', '```js', 'x()', '')).content,
      [
        { type: 'heading', attrs: { level: 1 }, content: [text('One')] },
        { type: 'heading', attrs: { level: 6 }, content: [text('Six')] },
        paragraph(text('####### Seven')),
        { type: 'codeBlock', content: [text('plain')] },
        { type: 'codeBlock', content: [] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [text('x()')] },
      ],
    )
  })

  it('what a quote or a list item can’t hold in ADF gives way', () => {
    assert.deepStrictEqual(adfOf(lines('> # Heading in a quote', '> - item', '> > nested', '> ---', '> ```sh', '> ls', '> ```')).content, [
      {
        type: 'blockquote',
        content: [
          paragraph(text('Heading in a quote')),
          { type: 'bulletList', content: [item(paragraph(text('item')))] },
          paragraph(text('nested')),
          { type: 'codeBlock', attrs: { language: 'sh' }, content: [text('ls')] },
        ],
      },
    ])
    assert.deepStrictEqual(
      adfOf(lines('- # heading item', '- > quote item', '- ```', '  code item', '  ```', '-   - nested first')).content,
      [
        {
          type: 'bulletList',
          content: [
            item(paragraph(text('heading item'))),
            item(paragraph(text('quote item'))),
            item({ type: 'codeBlock', content: [text('code item')] }),
            item(paragraph(), { type: 'bulletList', content: [item(paragraph(text('nested first')))] }),
          ],
        },
      ],
    )
  })

  it('lists: where they start, their kinds, blank lines, lazy lines and loose nesting', () => {
    assert.deepStrictEqual(
      adfOf(
        lines(
          '3. three',
          '4. four',
          '',
          '   more of four',
          '- bullet',
          '  - nested',
          '    lazy line',
          '-',
          '* star',
          '1) paren',
          '',
          'after',
        ),
      ).content,
      [
        {
          type: 'orderedList',
          attrs: { order: 3 },
          content: [item(paragraph(text('three'))), item(paragraph(text('four')), paragraph(text('more of four')))],
        },
        {
          type: 'bulletList',
          content: [
            item(paragraph(text('bullet')), {
              type: 'bulletList',
              content: [item(paragraph(text('nested'), { type: 'hardBreak' }, text('lazy line')))],
            }),
            item(paragraph()),
            item(paragraph(text('star'))),
          ],
        },
        { type: 'orderedList', attrs: { order: 1 }, content: [item(paragraph(text('paren')))] },
        paragraph(text('after')),
      ],
    )
    assert.deepStrictEqual(adfOf(lines('1. one', '  - two spaces', '2. two')).content, [
      {
        type: 'orderedList',
        attrs: { order: 1 },
        content: [
          item(paragraph(text('one')), { type: 'bulletList', content: [item(paragraph(text('two spaces')))] }),
          item(paragraph(text('two'))),
        ],
      },
    ])
    assert.deepStrictEqual(adfOf(lines('- a', '* * *', '- b', 'text after')).content, [
      { type: 'bulletList', content: [item(paragraph(text('a')))] },
      { type: 'rule' },
      { type: 'bulletList', content: [item(paragraph(text('b'), { type: 'hardBreak' }, text('text after')))] },
    ])
    assert.deepStrictEqual(adfOf(lines('- a', '', 'not in it')).content, [
      { type: 'bulletList', content: [item(paragraph(text('a')))] },
      paragraph(text('not in it')),
    ])
  })

  it('nothing as an empty document', () => {
    assert.deepStrictEqual(adfOf('\n\n'), { type: 'doc', version: 1, content: [] })
  })
})

describe('Markdown, written as wiki markup for Data Center', () => {
  it('a comment as Althar writes one', () => {
    assert.strictEqual(
      wikiOf(COMMENT),
      lines(
        'h2. Opened a draft pull request',
        '',
        '*Althar* opened [PR #12|https://github.com/meridian/api/pull/12] for _MER-231_, -not- with {{rate\\_limit}}.',
        'Second line, with [https://example.com/a_b].',
        '',
        '# First step',
        '#* nested one',
        '# Second step',
        '',
        '{quote}',
        'Quoted',
        '{quote}',
        '',
        '{noformat}',
        'const a = 1 * 2',
        '{noformat}',
        '',
        '----',
      ),
    )
  })

  it('keeps text as text where wiki markup would read a mark, a macro or a link', () => {
    assert.strictEqual(
      wikiOf('a {b} [c] *d* \\f a|b ~~e~~ [a|b](https://x.dev) [`c`](https://c.dev)'),
      'a \\{b\\} \\[c\\] _d_ \\\\f a|b -e- [a\\|b|https://x.dev] [{{c}}|https://c.dev]',
    )
  })

  it('code in a language Jira colours, and any other as plain text', () => {
    assert.strictEqual(
      wikiOf(lines('```js', 'x()', '```', '```Python', 'y()', '```', '```ts', 'z()', '```')),
      lines('{code:javascript}', 'x()', '{code}', '', '{code:python}', 'y()', '{code}', '', '{noformat}', 'z()', '{noformat}'),
    )
  })

  it('quotes flat, and what a list item holds after its first line', () => {
    assert.strictEqual(
      wikiOf(lines('> # Heading', '> > nested', '', '- ```', '  code item', '  ```', '-   - nested first', '- a', '', '  more of a')),
      lines(
        '{quote}',
        'h1. Heading',
        '',
        'nested',
        '{quote}',
        '',
        '* ',
        '{noformat}',
        'code item',
        '{noformat}',
        '* ',
        '** nested first',
        '* a',
        'more of a',
      ),
    )
  })
})

describe('every direction, however odd the text', () => {
  /** Well above what a description takes, well below what a search started again from each of many openers takes. */
  const LIMIT = 200
  const n = 50_000
  /** Text that once made a converter search again from each of many openers, backtrack over a run, or nest without end. */
  const odd: Readonly<Record<string, string>> = {
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
  const ordinary = `${KAFKA_21232}\n\n${COMMENT}\n\n`.repeat(40)
  /** ADF documents nested deeper and wider than any editor makes. */
  const nest = (depth: number, wrap: (inner: AdfNode) => AdfNode) => {
    let node: AdfNode = paragraph(text('deep'))
    for (let level = 0; level < depth; level += 1) node = wrap(node)
    return doc(node)
  }
  const documents: Readonly<Record<string, AdfNode>> = {
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
  const took = (convert: () => unknown) => {
    const started = performance.now()
    convert()
    return performance.now() - started
  }

  it('takes time in proportion to its length', () => {
    for (const [name, value] of Object.entries({ ...odd, 'an ordinary document': ordinary })) {
      const adf = adfOf(value)
      assert.isBelow(
        took(() => markdownOfWiki(value)),
        LIMIT,
        `wiki markup to Markdown: ${name}`,
      )
      assert.isBelow(
        took(() => wikiOf(value)),
        LIMIT,
        `Markdown to wiki markup: ${name}`,
      )
      assert.isBelow(
        took(() => adfOf(value)),
        LIMIT,
        `Markdown to ADF: ${name}`,
      )
      assert.isBelow(
        took(() => markdownOfAdf(adf)),
        LIMIT,
        `ADF to Markdown: ${name}`,
      )
    }
    for (const [name, value] of Object.entries(documents))
      assert.isBelow(
        took(() => markdownOfAdf(value)),
        LIMIT,
        `ADF to Markdown: ${name}`,
      )
  })

  it('reads what is nested deeper than anything written by hand as text', () => {
    // Sixteen quotes are read, the rest is a paragraph's text; ADF holds them as one quote.
    assert.deepStrictEqual(adfOf('>'.repeat(40)).content, [{ type: 'blockquote', content: [paragraph(text('>'.repeat(24)))] }])
    // Under the document, fifteen quotes, then the words of what is deeper.
    assert.strictEqual(markdownOfAdf(nest(20, (node) => ({ type: 'blockquote', content: [node] }))), `${'> '.repeat(15)}deep`)
    assert.strictEqual(
      markdownOfAdf(
        doc({ type: 'unknown', content: [{ type: 'unknown', content: [text('a'), { type: 'emoji', attrs: { text: '✅' } }] }] }),
      ),
      'a✅',
    )
  })
})
