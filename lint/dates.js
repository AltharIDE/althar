import { defineRule } from 'vite-plus/lint/plugins'

/*
 * A future time is relative to the test's present (DEVELOPMENT.md, Tests that hold). A test or fixture that writes a
 * date still to come passes until the calendar reaches it, and fails on every pull request after: #1219's
 * `2026-11-26T00:00:00Z` turned main red the day it landed. This fails on a date or timestamp after now in a string, a
 * template, or JSON and SQL written in one, in the tests, the specs and their fixtures; not in comments, or in a
 * calendar date written in prose, which is copy. Use `isoAfter(milliseconds)` from @althar/testing for a live future
 * time, and historical dates with an explicit test clock.
 *
 * This was a test of @althar/testing that read every test in the repository, which ran on a pull request only when it
 * changed that package; here it runs in the checks of the package whose test has the date. It reads the clock where
 * lint runs: a date that is past stays past.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAYS = /\b\d{4}-\d{2}-\d{2}/g
const TIMES = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g

export const noFutureDates = defineRule({
  meta: {
    type: 'problem',
    messages: {
      future:
        '{{date}} is in the future: the test passes until the calendar reaches it, and fails after. Use isoAfter from @althar/testing for a live future time, or a historical date with an explicit test clock.',
    },
  },
  create(context) {
    const now = Date.now()
    const look = (node, dates) => {
      for (const match of context.sourceCode.getText(node).matchAll(dates))
        if (Date.parse(match[0]) > now) context.report({ node, messageId: 'future', data: { date: match[0] } })
    }
    return {
      // A calendar date alone is a value; in words it is copy (and may mirror the app's wording), so only a timestamp
      // there, as in SQL or JSON, is one.
      Literal(node) {
        if (typeof node.value === 'string') look(node, DATE.test(node.value) ? DAYS : TIMES)
      },
      TemplateElement(node) {
        look(node, TIMES)
      },
    }
  },
})
