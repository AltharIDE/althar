import { defineRule } from 'vite-plus/lint/plugins'

/*
 * One way to remove (ARCHITECTURE.md, Failures and diagnostics). A folder can still be held a moment after the process
 * that ran in it has gone, as Windows holds one while the process's tree goes, so a removal that runs once and throws
 * loses what the work it followed found: a probe's models (#446), a permission's judgment (#448). The runtime and the
 * agent adapters remove only through `cleanUp`, best effort, which never fails and logs what stays, or `removeFully`,
 * which fails saying what stayed, both tried again over a moment (packages/provider-adapters/src/removal.ts). This
 * fails on `rmSync` and `rmdirSync`, and on `rm` and `rmdir` from `node:fs/promises`, in their `src`. Where the
 * helpers won't do, the line says why with `oxlint-disable-next-line althar/one-removal`:
 *
 * - a link or a file removed alone, never recursively, so nothing it points at goes, where clearing the place is the
 *   work and fails it (Installs' `current` junction on Windows, coordinatorFolder's `clearedFor`);
 * - a folder removed only if it is empty, where one that isn't stays by design (FolderCleanup's `eraseEmpty`);
 * - plain Node shared with the app's main process, which takes no Effect, removing as `cleanUp` does, never failing,
 *   and saying what stays (attachments.ts, what was copied of a file a message refused).
 */

const SYNC = new Set(['rmSync', 'rmdirSync'])
const PROMISED = new Set(['rm', 'rmdir'])
const PROMISES = new Set(['node:fs/promises', 'fs/promises'])

/** `fs.rmSync`, `fs.promises.rm`: the name a member is read by. */
const propertyOf = (node) =>
  node.computed ? (node.property.type === 'Literal' ? String(node.property.value) : undefined) : node.property.name

export const oneRemoval = defineRule({
  meta: {
    type: 'problem',
    messages: {
      remove:
        '{{name}} throws or rejects where a folder is still held, as Windows holds one a moment after the process in it: remove with cleanUp (best effort, a leftover logged) or removeFully (retried, a typed failure) from @althar/provider-adapters.',
    },
  },
  create(context) {
    /** Names `rm` and `rmdir` from `node:fs/promises` go by here, as imported. */
    const promised = new Set()
    const report = (node, name) => context.report({ node, messageId: 'remove', data: { name } })
    return {
      ImportDeclaration(node) {
        if (!PROMISES.has(node.source.value)) return
        for (const specifier of node.specifiers)
          if (specifier.type === 'ImportSpecifier' && PROMISED.has(specifier.imported.name ?? specifier.imported.value))
            promised.add(specifier.local.name)
      },
      CallExpression(node) {
        const callee = node.callee
        if (callee.type === 'Identifier') {
          if (SYNC.has(callee.name)) report(node, callee.name)
          else if (promised.has(callee.name)) report(node, callee.name)
          return
        }
        if (callee.type !== 'MemberExpression') return
        const name = propertyOf(callee)
        if (name === undefined) return
        // `fs.rmSync(…)`, and `fs.promises.rm(…)` or `promises.rm(…)`.
        const object = callee.object
        const onPromises =
          (object.type === 'Identifier' && object.name === 'promises') ||
          (object.type === 'MemberExpression' && propertyOf(object) === 'promises')
        if (SYNC.has(name) || (onPromises && PROMISED.has(name))) report(node, name)
      },
    }
  },
})
