import { defineRule } from 'vite-plus/lint/plugins'

/*
 * A press shows its result at once (docs/decisions/foundations.md, The UI is instant). What the person presses changes the
 * window in the same frame, from the window's own state, and the runtime catches up behind it; a failure takes it back
 * with a line saying why. A handler written in place that waits for a call before it changes anything, as
 * `onClear={() => void model.markDone().then(onBack)}` or `onSave={async () => { if (await save()) close() }}`, makes
 * the press wait on the runtime, git or the network: an aside's Clear went back only once its task had settled, and
 * its pill went a moment after.
 *
 * This fails on an `on…` handler written in place that awaits, or chains `.then`, before anything else it does: its
 * first statement that does something, past guards that return, is the wait. Change what shows first (patch the
 * cache, set the state, move, close), then `void` the call and take the change back in its `.then` or `.catch` if it
 * failed; a view model's intent does the same inside. `.catch` and `.finally` are how a change is taken back, so they
 * never count. Where waiting is the point, as for a system dialog the person answers, a form whose answer only the
 * runtime can check and whose error goes at its field, or something only the answer can show (a new id to open), the
 * line says why with `oxlint-disable-next-line althar/press-at-once`. A named handler, and a view model's intent, are
 * outside what this reads: review reads those.
 */

const CHAINS = new Set(['then'])
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])
const SKIP = new Set(['parent', 'loc', 'range', 'start', 'end'])

/** The first await or `.then` in a piece of a handler, not in a function it makes. */
const waitIn = (node) => {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const one of node) {
      const found = waitIn(one)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (FUNCTIONS.has(node.type)) return undefined
  if (node.type === 'AwaitExpression') return 'await'
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    CHAINS.has(node.callee.property.name)
  )
    return `.${node.callee.property.name}`
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue
    const found = waitIn(node[key])
    if (found !== undefined) return found
  }
  return undefined
}

/** `if (x === undefined) return`: a guard, which changes nothing. */
const guard = (statement) =>
  statement.type === 'IfStatement' &&
  statement.alternate === null &&
  (statement.consequent.type === 'ReturnStatement' ||
    (statement.consequent.type === 'BlockStatement' &&
      statement.consequent.body.length === 1 &&
      statement.consequent.body[0].type === 'ReturnStatement'))

/** How a handler waits before it changes anything, if it does. */
const waitsFirst = (body) => {
  if (body.type !== 'BlockStatement') return waitIn(body)
  for (const statement of body.body) {
    if (guard(statement) || statement.type === 'VariableDeclaration') {
      const found = waitIn(statement)
      if (found !== undefined) return found
      continue
    }
    return waitIn(statement)
  }
  return undefined
}

export const pressAtOnce = defineRule({
  meta: {
    type: 'problem',
    messages: {
      waits:
        '{{name}} waits ({{how}}) before it changes anything, so the press shows nothing until the call answers: change what shows first, optimistically, then let the call catch up and take it back with a line if it fails; or say why with oxlint-disable-next-line.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !/^on[A-Z]/.test(node.name.name)) return
        const handler = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : undefined
        if (handler === undefined || (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression')) return
        const how = waitsFirst(handler.body)
        if (how !== undefined) context.report({ node, messageId: 'waits', data: { name: node.name.name, how } })
      },
    }
  },
})
