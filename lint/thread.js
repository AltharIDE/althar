import { defineRule } from 'vite-plus/lint/plugins'

/*
 * Nothing heavy on a thread that answers the person (docs/decisions/foundations.md, The UI is instant). The
 * runtime's one thread answers every window and runs every agent's session, and the main process draws every window's
 * frame and carries its messages: a call that holds either holds every click. Starting a child process and waiting for
 * it to end holds it for as long as the child runs, seconds under load, and a recursive copy for as long as the disk
 * takes. This fails on `execSync`, `execFileSync`, `spawnSync` and `cpSync` there, by whatever name they are imported or
 * taken out as (`import { execFileSync as run } from 'node:child_process'`, `const { spawnSync: probe } = cp`). Run a
 * process through the runtime's runner (`spawner.ts`, `git.ts`) or `node:child_process`'s own asynchronous calls, and
 * copy with `fs/promises`. Where only a synchronous call will do, the line says why with
 * `oxlint-disable-next-line althar/off-the-thread`.
 */

const HOLDS = {
  execSync: 'a child process',
  execFileSync: 'a child process',
  spawnSync: 'a child process',
  cpSync: 'a recursive copy',
}

/** `cp.spawnSync`, `fs.cpSync`: the name a member is read by. */
const propertyOf = (node) =>
  node.computed ? (node.property.type === 'Literal' ? String(node.property.value) : undefined) : node.property.name

/** `{ spawnSync: probe }`, `{ 'cpSync': copy }`: the name a destructured property is read by. */
const keyOf = (property) =>
  property.computed
    ? property.key.type === 'Literal'
      ? String(property.key.value)
      : undefined
    : property.key.type === 'Identifier'
      ? property.key.name
      : property.key.type === 'Literal'
        ? String(property.key.value)
        : undefined

export const offTheThread = defineRule({
  meta: {
    type: 'problem',
    messages: {
      holds:
        '{{name}} holds this thread until {{what}} ends, and every window waits with it: start it asynchronously (the runtime’s spawner, node:child_process’s execFile or spawn, fs/promises), or say why with oxlint-disable-next-line.',
    },
  },
  create(context) {
    const report = (node, name) => context.report({ node, messageId: 'holds', data: { name, what: HOLDS[name] } })
    /** Each call by the name it was given here, where that is another (`local`): followed to wherever it is called. */
    const callsOf = (declared, local, name) => {
      for (const variable of context.sourceCode.getDeclaredVariables(declared)) {
        if (variable.name !== local) continue
        for (const reference of variable.references) {
          const call = reference.identifier.parent
          if (call?.type === 'CallExpression' && call.callee === reference.identifier) report(call, name)
        }
      }
    }
    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue
          const imported = specifier.imported.name ?? specifier.imported.value
          if (Object.hasOwn(HOLDS, imported) && specifier.local.name !== imported) callsOf(specifier, specifier.local.name, imported)
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern') return
        for (const property of node.id.properties) {
          if (property.type !== 'Property') continue
          const name = keyOf(property)
          // `{ spawnSync: probe = fallback }` is named `probe` as well.
          const local = property.value.type === 'AssignmentPattern' ? property.value.left : property.value
          if (name !== undefined && Object.hasOwn(HOLDS, name) && local.type === 'Identifier' && local.name !== name)
            callsOf(node, local.name, name)
        }
      },
      CallExpression(node) {
        const callee = node.callee
        const name = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' ? propertyOf(callee) : undefined
        if (name !== undefined && Object.hasOwn(HOLDS, name)) report(node, name)
      },
    }
  },
})
