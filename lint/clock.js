import { defineRule } from 'vite-plus/lint/plugins'

/*
 * One clock (docs/plans/tests-that-hold.md, A). The runtime, and the packages it uses, read the time and wait only
 * through Effect's Clock: in production it is the system's, and in a test it is the test's, so what happens on a timer
 * is tested on TestClock, at once and the same every time. A read of the system's own clock beside it is a second
 * clock, which a test can't move. Where only the system's will do, as for a child process's time to finish, kept by
 * Node outside any effect, the line says why with `oxlint-disable-next-line althar/one-clock`.
 */

/** What each reads, and what reads it through Effect's Clock instead. */
const READS = {
  'Date.now': 'Clock.currentTimeMillis',
  'performance.now': 'Clock.currentTimeMillis',
  'DateTime.nowUnsafe': 'DateTime.now',
}
const TIMERS = { setTimeout: 'Effect.sleep', setInterval: 'Schedule' }

/** `Date.now`, `globalThis.setTimeout`: the name a member is read by, where its object is a plain name. */
const memberOf = (node) =>
  node.type === 'MemberExpression' && node.object.type === 'Identifier'
    ? `${node.object.name}.${node.computed ? (node.property.type === 'Literal' ? node.property.value : '') : node.property.name}`
    : undefined

export const oneClock = defineRule({
  meta: {
    type: 'problem',
    messages: {
      read: '{{read}} reads the system clock, which a test can’t move: read {{instead}}.',
      now: '{{read}} with no time is now, by the system clock, which a test can’t move: read DateTime.now or Clock.currentTimeMillis.',
      timer: '{{read}} waits by the system clock, which a test can’t move: wait with {{instead}}.',
    },
  },
  create(context) {
    const timer = (node, name) => {
      if (Object.hasOwn(TIMERS, name)) context.report({ node, messageId: 'timer', data: { read: name, instead: TIMERS[name] } })
    }
    return {
      MemberExpression(node) {
        const name = memberOf(node)
        if (name === undefined) return
        if (Object.hasOwn(READS, name)) context.report({ node, messageId: 'read', data: { read: name, instead: READS[name] } })
        if (node.object.name === 'globalThis' || node.object.name === 'window') timer(node, name.slice(name.indexOf('.') + 1))
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0)
          context.report({ node, messageId: 'now', data: { read: 'new Date()' } })
      },
      CallExpression(node) {
        // `Date()` without `new` is now too, as a string.
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date')
          context.report({ node, messageId: 'now', data: { read: 'Date()' } })
        if (node.callee.type === 'Identifier') timer(node, node.callee.name)
      },
    }
  },
})
