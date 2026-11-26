import { defineRule } from 'vite-plus/lint/plugins'

/*
 * A spec presses each system's own keys (DEVELOPMENT.md, Tests that hold). The end-to-end run is on Linux and Windows
 * too, where Althar's shortcuts are Ctrl's and the Super key is no modifier of ours: `Meta+n` there opens nothing, and
 * the spec waits out its time for what it opened. `ControlOrMeta+n` is each system's own. This fails on a key pressed
 * with `Meta+` in the end-to-end specs; a spec that means one system names it, and says why with
 * `oxlint-disable-next-line althar/system-keys`.
 */

/** A member's name, written as a name or as a string. */
const nameOf = (key) => (key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? String(key.value) : undefined)

export const systemKeys = defineRule({
  meta: {
    type: 'problem',
    messages: {
      mac: '{{key}} is a Mac’s key on every system: on Linux and Windows it opens nothing. Press ControlOrMeta+{{rest}}, each system’s own.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node
        const [first] = node.arguments
        if (
          callee.type === 'MemberExpression' &&
          nameOf(callee.property) === 'press' &&
          first?.type === 'Literal' &&
          String(first.value).startsWith('Meta+')
        )
          context.report({ node, messageId: 'mac', data: { key: String(first.value), rest: String(first.value).slice('Meta+'.length) } })
      },
    }
  },
})
