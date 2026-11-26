import { defineRule } from 'vite-plus/lint/plugins'

/*
 * A test takes its size's time, never a time of its own (DEVELOPMENT.md, Tests that hold). Each test takes its size's
 * budget, scaled for the machine (@althar/testing's budget.ts), and its waits go by that; a time picked where a test
 * once ran out is right for the machine it ran out on. This fails, in the tests, on a test, hook or wait given a time
 * of its own, or a loop that gives up after so many tries (`althar/test-time`); and in the end-to-end specs and their
 * config, on a time that isn't the budget's, or a sleep (`althar/spec-time`): a spec waits for what it looks for, with
 * Playwright's own waiting, never for a while. vite.config.ts names the tests that keep their own times by design:
 * those of real agents and accounts, run by hand, and a benchmark run by hand.
 *
 * These were tests of @althar/testing that read every test in the repository, which ran on a pull request only when it
 * changed that package; here each runs in the checks of the package whose test it reads.
 */

/** The name a call starts from: `it` for `it.live.skipIf(…)(…)`, `page` for `page.getByText(…).waitFor(…)`. */
const rootOf = (node) => {
  for (let at = node; at !== undefined && at !== null;) {
    if (at.type === 'Identifier') return at.name
    at = at.type === 'MemberExpression' ? at.object : at.type === 'CallExpression' ? at.callee : undefined
  }
  return undefined
}

/** A property's or a member's name, written as a name or as a string. */
const nameOf = (key) => (key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? String(key.value) : undefined)

/** A loop that tries so many times, sleeping between: a wait with a time of its own. */
const giveUp = (node, text, sleeps) => node.test !== null && /<\s*[0-9_]+/.test(text(node.test)) && sleeps.test(text(node.body))

const TESTS = new Set(['it', 'test', 'describe'])
const HOOKS = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach'])
const WAITS = new Set(['until', 'waitFor'])
/* testing-library's: they give up where the test's waits do, as the desktop app's and the kit's tests/setup.ts set. */
const FINDS = /^find(All)?By[A-Z]/
const DOM_WAITS = new Set(['waitFor', 'waitForElementToBeRemoved'])

/* What runs as a test, which follows its options in `test(name, options, fn)`. */
const FUNCTION = new Set(['ArrowFunctionExpression', 'FunctionExpression'])

/** Whether an argument is words: a string, or a template of one. */
const words = (node) => (node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateLiteral'

export const testTime = defineRule({
  meta: {
    type: 'problem',
    messages: {
      own: '{{what}} gives a time of its own ({{time}}): a test takes its size’s budget, from testing() in its package’s Vitest config, or budget.large by name.',
      loop: 'A wait that gives up after so many tries: wait with until or waitFor, which give up by the test’s own time.',
    },
  },
  create(context) {
    const text = (node) => context.sourceCode.getText(node)
    const own = (node, what, time) => context.report({ node, messageId: 'own', data: { what, time: text(time) } })
    return {
      CallExpression(node) {
        const { callee, arguments: args } = node
        const name = rootOf(callee)
        // A test's time is its third argument, or a `timeout` in options given second; a size by name is the one way.
        if (name !== undefined && TESTS.has(name)) {
          if (args[2] !== undefined && !FUNCTION.has(args[2].type) && !text(args[2]).startsWith('budget.')) own(node, 'A test', args[2])
          if (args[1]?.type === 'ObjectExpression' && /\btimeout\b/.test(text(args[1]))) own(node, 'A test', args[1])
        }
        if (callee.type === 'Identifier' && HOOKS.has(callee.name) && args[1] !== undefined) own(node, 'A hook', args[1])
        // A wait's third argument names what it waits for; anything else there, or more, is a time.
        if (callee.type === 'Identifier' && WAITS.has(callee.name) && args.length > 2 && !(words(args[2]) && args.length === 3))
          own(node, 'A wait', args.at(-1))
        const method = callee.type === 'MemberExpression' ? nameOf(callee.property) : callee.type === 'Identifier' ? callee.name : undefined
        if (typeof method === 'string' && FINDS.test(method) && args[2] !== undefined && /\btimeout\b/.test(text(args[2])))
          own(node, 'A find', args[2])
        if (
          typeof method === 'string' &&
          DOM_WAITS.has(method) &&
          args[1]?.type === 'ObjectExpression' &&
          /\btimeout\b/.test(text(args[1]))
        )
          own(node, 'A wait', args[1])
      },
      ForStatement(node) {
        if (giveUp(node, text, /setTimeout|Effect\.sleep/)) context.report({ node, messageId: 'loop' })
      },
    }
  },
})

/** Whether a time is a size's budget, by name: `budget.medium`. */
const budgeted = (node) => node?.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'budget'

/** Times a page or a test is given for every wait after. */
const DEFAULTS = new Set(['setDefaultTimeout', 'setDefaultNavigationTimeout'])

export const specTime = defineRule({
  meta: {
    type: 'problem',
    messages: {
      own: 'A time of its own ({{text}}): a spec takes the budget’s, by name (budget.medium, budget.large), as playwright.config.ts gives its tests and their assertions.',
      test: 'A test’s time of its own ({{text}}): each spec takes budget.large from playwright.config.ts.',
      every: 'A time of its own for every wait after it ({{text}}): take the budget’s, by name.',
      sleep:
        'A sleep ({{text}}): too short on a slow machine and wasted on a fast one. Wait for what it looks for (expect, expect.poll, locator.waitFor, page.waitForFunction).',
      loop: 'A wait that gives up after so many tries: wait for what it looks for.',
    },
  },
  create(context) {
    const text = (node) => context.sourceCode.getText(node)
    const report = (node, messageId) => context.report({ node, messageId, data: { text: text(node) } })
    return {
      // `{ timeout: … }` given to an assertion, an action, a wait or a launch, or `{ actionTimeout: … }` to `test.use`.
      Property(node) {
        if (/timeout$/i.test(nameOf(node.key) ?? '') && !budgeted(node.value)) report(node, 'own')
      },
      ForStatement(node) {
        if (giveUp(node, text, /setTimeout|waitForTimeout|sleep/)) context.report({ node, messageId: 'loop' })
      },
      CallExpression(node) {
        const { callee } = node
        const named = callee.type === 'MemberExpression' ? nameOf(callee.property) : undefined
        if (named === 'waitForTimeout') report(node, 'sleep')
        // `test.setTimeout(…)`, `test.info().setTimeout(…)` or a fixture's `testInfo.setTimeout(…)`; in a page, `window.setTimeout(…)`.
        else if (named === 'setTimeout' || named === 'setInterval') report(node, rootOf(callee) === 'window' ? 'sleep' : 'test')
        else if (named === 'slow' && rootOf(callee) === 'test') report(node, 'test')
        else if (named !== undefined && DEFAULTS.has(named) && !budgeted(node.arguments[0])) report(node, 'every')
        else if (callee.type === 'Identifier' && (callee.name === 'setTimeout' || callee.name === 'setInterval')) report(node, 'sleep')
      },
    }
  },
})
