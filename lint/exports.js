import { defineRule } from 'vite-plus/lint/plugins'

/*
 * Each name is exported from the file that makes it (packages/runtime/ARCHITECTURE.md, "Where a file goes"). A file
 * that passes on what another makes, `export … from` or an imported name exported again, can be imported for what it
 * doesn't make: that is how the runtime's split files kept their old addresses, and how its import cycles were built,
 * the file a part was split from imported back by the parts through its re-exports. Only an index.ts, a package's or a
 * folder's entry, re-exports. Import a name from where it is made; where a name moves, its importers move with it.
 */

const isIndex = (filename) => /(^|[\\/])index\.[cm]?[jt]sx?$/.test(filename)

const nameOf = (node) => (node.type === 'Literal' ? String(node.value) : node.name)

export const exportedWhereMade = defineRule({
  meta: {
    type: 'problem',
    messages: {
      from: '{{name}} is made in {{source}}: import it from there where it is used, and only an index.ts passes it on.',
      imported: '{{name}} is imported here from {{source}}: import it from there where it is used, and only an index.ts passes it on.',
    },
  },
  create(context) {
    if (isIndex(context.filename)) return {}
    return {
      Program(program) {
        // What this file imports, by the name it has here: where it comes from.
        const imported = new Map()
        for (const node of program.body)
          if (node.type === 'ImportDeclaration')
            for (const specifier of node.specifiers) imported.set(specifier.local.name, node.source.value)
        for (const node of program.body) {
          if (node.type === 'ExportAllDeclaration')
            context.report({
              node,
              messageId: 'from',
              data: { name: node.exported ? nameOf(node.exported) : '*', source: node.source.value },
            })
          else if (node.type === 'ExportNamedDeclaration' && node.source)
            for (const specifier of node.specifiers)
              context.report({ node: specifier, messageId: 'from', data: { name: nameOf(specifier.exported), source: node.source.value } })
          else if (node.type === 'ExportNamedDeclaration' && node.declaration === null)
            for (const specifier of node.specifiers) {
              const local = nameOf(specifier.local)
              if (imported.has(local))
                context.report({
                  node: specifier,
                  messageId: 'imported',
                  data: { name: nameOf(specifier.exported), source: imported.get(local) },
                })
            }
          else if (
            node.type === 'ExportDefaultDeclaration' &&
            node.declaration.type === 'Identifier' &&
            imported.has(node.declaration.name)
          )
            context.report({ node, messageId: 'imported', data: { name: 'default', source: imported.get(node.declaration.name) } })
        }
      },
    }
  },
})
