import { defineRule } from 'vite-plus/lint/plugins'

/*
 * A press shows its result at once (docs/decisions/foundations.md, The UI is instant). What the person presses changes the
 * window in the same frame, from the window's own state, and the runtime catches up behind it; a failure takes it back
 * with a line saying why. A handler written in place that waits for a call before it changes anything, as
 * `onClear={() => void model.markDone().then(onBack)}` or `onSave={async () => { if (await save()) close() }}`, makes
 * the press wait on the runtime, git or the network: an aside's Clear went back only once its task had settled, and
 * its pill went a moment after.
 *
 * This fails on an `on…` handler that awaits, or chains `.then` or `.finally`, before anything else it does: its first
 * statement that does something, past guards that return, is the wait. Marking the press busy (`setBusy(true)`,
 * `setPending`, `setActing`…) or clearing the last error isn't its result, so a handler that does only that before it
 * waits, as `setSaving(true); await save(); close()`, waits too. A handler named in place (`onEdit={edit}`, or
 * `onEdit={(id) => void edit(id)}`) is read where it is declared in the same file, as one written in place is. Change
 * what shows first (patch the cache, set the state, move, close), then `void` the call and take the change back in its
 * `.then` or `.catch` if it failed; a view model's intent does the same inside. `.catch` alone is how a change is taken
 * back, so it never counts. Where waiting is the point, as for a system dialog the person answers, a form whose answer
 * only the runtime can check and whose error goes at its field, or something only the answer can show (a new id to
 * open), the line says why with `oxlint-disable-next-line althar/press-at-once`. A view model's intent, and a handler
 * passed down from another file, are outside what this reads: review reads those.
 */

const CHAINS = new Set(['then', 'finally'])
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])
const SKIP = new Set(['parent', 'loc', 'range', 'start', 'end'])
/** `setBusy(true)`, `setPending(…)`, `setActing(…)`: the press marked under way, which isn't what it does. */
const BUSY = /^set(Busy|Pending|Acting|Doing|Saving|Working|Loading|Submitting|Sending|Running|Checking|Waiting)(?![a-z])/
/** `setError(null)`, `setFailed(undefined)`: what went wrong last time cleared, which isn't what it does either. */
const ERROR = /^set\w*(Error|Failed|Failure)$/
const DISMISS = new Set(['dismissError'])

/** `(async () => { … })()`: a function called where it is made, whose body runs as the handler's own. */
const calledInPlace = (node) => node.type === 'CallExpression' && FUNCTIONS.has(node.callee.type)

/** `() => undefined`, `() => {}`: a callback that does nothing, as `.then(() => undefined, takeBack)` leaves the answer. */
const nothing = (fn) =>
  FUNCTIONS.has(fn.type) &&
  ((fn.body.type === 'BlockStatement' && fn.body.body.length === 0) ||
    (fn.body.type === 'Identifier' && fn.body.name === 'undefined') ||
    (fn.body.type === 'UnaryExpression' && fn.body.operator === 'void' && fn.body.argument.type === 'Literal'))

/** A callback that only lets go of the press's busy, or says what went wrong: `.finally(() => setSaving(false))`. */
const onlyBusy = (fn) => {
  if (!FUNCTIONS.has(fn.type)) return false
  const body = fn.body.type === 'BlockStatement' ? fn.body.body : [{ type: 'ExpressionStatement', expression: fn.body }]
  return body.length > 0 && body.every(preliminary)
}

/**
 * Whether a `.then` or `.finally` waits for what the press shows: not one that only lets go of its busy once the call
 * answers, nor a `.then` that does nothing with the answer and takes the press back where it failed, as `.catch` does.
 */
const waitsWith = (call) => {
  const [first, second] = call.arguments
  if (first === undefined) return false
  if (call.callee.property.name === 'then' && second !== undefined && nothing(first)) return false
  return !onlyBusy(first)
}

/** The first await or `.then` or `.finally` in a piece of a handler, not in a function it makes (but one it calls in place). */
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
  if (calledInPlace(node)) return waitIn(node.arguments) ?? waitsFirst(node.callee.body)
  if (node.type === 'AwaitExpression') return 'await'
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    CHAINS.has(node.callee.property.name) &&
    waitsWith(node)
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

/** A value that clears: `null`, `undefined`, `''`, or none. */
const clears = (args) =>
  args.length === 0 ||
  (args.length === 1 &&
    ((args[0].type === 'Literal' && (args[0].value === null || args[0].value === '')) ||
      (args[0].type === 'Identifier' && args[0].name === 'undefined')))

/** The name a call is made by: `setBusy(…)`'s, `model.dismissError()`'s. */
const calleeName = (call) =>
  call.callee.type === 'Identifier'
    ? call.callee.name
    : call.callee.type === 'MemberExpression' && !call.callee.computed
      ? call.callee.property.name
      : undefined

/** `true`, `ask`, `'push'`: what a busy flag is set to, not a change to a map of what shows (`setPending((now) => …)`). */
const flag = (args) =>
  args.length === 1 && !FUNCTIONS.has(args[0].type) && args[0].type !== 'ObjectExpression' && args[0].type !== 'ArrayExpression'

/** `setBusy(true);`, `setError(null);`: what a press does before its result that isn't its result. */
const preliminary = (statement) => {
  if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'CallExpression') return false
  const call = statement.expression
  const name = calleeName(call)
  if (name === undefined) return false
  return (
    (call.callee.type === 'Identifier' && BUSY.test(name) && flag(call.arguments)) ||
    (ERROR.test(name) && clears(call.arguments)) ||
    DISMISS.has(name)
  )
}

/** How a handler waits before it changes anything, if it does. */
const waitsFirst = (body) => {
  if (body.type !== 'BlockStatement') return waitIn(body)
  for (const statement of body.body) {
    if (guard(statement) || statement.type === 'VariableDeclaration' || preliminary(statement)) {
      const found = waitIn(statement)
      if (found !== undefined) return found
      continue
    }
    return waitIn(statement)
  }
  return undefined
}

/** The function a name is declared as, in the scopes around `node` in this file: `const edit = async () => …`, `function edit() {}`. */
const declared = (context, node, name) => {
  for (let scope = context.sourceCode.getScope(node); scope !== null; scope = scope.upper) {
    const variable = scope.set.get(name)
    if (variable === undefined) continue
    const definition = variable.defs.at(-1)?.node
    if (definition === undefined) return undefined
    if (definition.type === 'FunctionDeclaration') return definition
    if (definition.type === 'VariableDeclarator' && definition.init !== null && FUNCTIONS.has(definition.init.type)) return definition.init
    return undefined
  }
  return undefined
}

/** The call a handler's whole first doing is, where it is one: `edit(id)` in `(id) => void edit(id)` or `() => { edit(id) }`. */
const onlyCall = (body) => {
  let first = body
  if (body.type === 'BlockStatement') {
    const doing = body.body.filter((statement) => !preliminary(statement))
    if (doing.length !== 1 || doing[0].type !== 'ExpressionStatement') return undefined
    first = doing[0].expression
  }
  if (first.type === 'UnaryExpression' && first.operator === 'void') first = first.argument
  return first.type === 'CallExpression' && first.callee.type === 'Identifier' ? first.callee.name : undefined
}

export const pressAtOnce = defineRule({
  meta: {
    type: 'problem',
    messages: {
      waits:
        '{{name}} waits ({{how}}) before it changes anything, so the press shows nothing until the call answers: change what shows first, optimistically, then let the call catch up and take it back with a line if it fails; or say why with oxlint-disable-next-line.',
      named:
        '{{name}} calls {{handler}}, which waits ({{how}}) before it changes anything, so the press shows nothing until the call answers: change what shows first, optimistically, then let the call catch up and take it back with a line if it fails; or say why with oxlint-disable-next-line.',
    },
  },
  create(context) {
    /** How a handler declared under this name waits first, read once however many presses name it. */
    const read = new Map()
    const waitsOf = (node, name) => {
      const fn = declared(context, node, name)
      if (fn === undefined) return undefined
      if (!read.has(fn)) {
        // Declared calling itself, or another that calls it back: what it is read as so far.
        read.set(fn, undefined)
        read.set(fn, waitsFirst(fn.body) ?? throughNamed(fn, fn.body))
      }
      return read.get(fn)
    }
    /** How a handler that only calls one named in its file waits, through that one. */
    const throughNamed = (node, body) => {
      const name = onlyCall(body)
      return name === undefined ? undefined : waitsOf(node, name)
    }
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !/^on[A-Z]/.test(node.name.name)) return
        const handler = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : undefined
        if (handler === undefined) return
        if (handler.type === 'Identifier') {
          const how = waitsOf(handler, handler.name)
          if (how !== undefined) context.report({ node, messageId: 'named', data: { name: node.name.name, handler: handler.name, how } })
          return
        }
        if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') return
        const how = waitsFirst(handler.body)
        if (how !== undefined) return context.report({ node, messageId: 'waits', data: { name: node.name.name, how } })
        const called = onlyCall(handler.body)
        const through = called === undefined ? undefined : waitsOf(handler, called)
        if (through !== undefined)
          context.report({ node, messageId: 'named', data: { name: node.name.name, handler: called, how: through } })
      },
    }
  },
})
