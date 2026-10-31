import { measure } from '@althar/testing/performance'
import { describe, test } from 'vitest'

import { adfOf, markdownOfAdf, markdownOfWiki, wikiOf } from '../src/jiraText'
import { documents, odd, ordinary } from './jiraTexts'

/*
 * How fast Jira's text goes each way, however odd, for the performance run (`bun run test:performance`), which gates
 * nothing. That each comes out at all is jiraText.test.ts's.
 */

/** Well above what a description takes, well below what a search started again from each of many openers takes. */
const BUDGET = 200

const texts = Object.entries({ ...odd, 'an ordinary document': ordinary })
/** What Markdown makes as ADF, beside ADF documents nested deeper and wider than any editor makes. */
const adf = [...texts.map(([name, value]) => [`${name}, made from Markdown`, adfOf(value)] as const), ...Object.entries(documents)]

/** One test for each text, each benchmarked within its test's time. */
const each = <T>(direction: string, all: ReadonlyArray<readonly [string, T]>, convert: (value: T) => unknown) =>
  describe(`${direction} takes time in proportion to its length`, () => {
    for (const [name, value] of all) test(name, (context) => measure(context, BUDGET, { [name]: () => convert(value) }))
  })

each('wiki markup to Markdown', texts, markdownOfWiki)
each('Markdown to wiki markup', texts, wikiOf)
each('Markdown to ADF', texts, adfOf)
each('ADF to Markdown', adf, markdownOfAdf)
