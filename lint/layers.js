import { defineRule } from 'vite-plus/lint/plugins'

import { layers as runtime } from '../packages/runtime/layers.js'

/*
 * Layers as a table (packages/runtime/ARCHITECTURE.md, "Where a file goes"). A table places every module of a folder in
 * a layer, top to bottom, and a module imports only from its own layer and the ones below it: so it can be read, and
 * changed, knowing only what is under it, and the import cycles the runtime once had (a split file's parts importing it
 * back through its re-exports) can't start again. The areas of one layer may import each other; import/no-cycle keeps
 * them from going round. This fails on an import of a module in a higher layer, and on a module the table doesn't
 * place: a new file picks its layer. An `import type` may point up: it loads nothing, and the modules that need one
 * name the options, events or errors of what is above them. An import the table lists as an exception passes.
 */

const TABLES = [runtime]

/** `Runs.ts`, `api/**`, `elsewhere/*.ts`: an entry of the table, as a test of a path. `**` is any folders, `*` any name. */
const patternOf = (entry) =>
  entry.includes('*')
    ? new RegExp(
        `^${entry
          .split(/(\*\*\/?|\*)/)
          .map((part) =>
            part === '**' ? '.*' : part === '**/' ? '(?:.*/)?' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'),
          )
          .join('')}$`,
      )
    : undefined

/** Each module's place in a table, `{ layer, at, area }`, by its path under the table's root: a name before a folder. */
export const placesOf = (table) => {
  const exact = new Map()
  const globs = []
  table.layers.forEach((layer, at) => {
    for (const [area, entries] of Object.entries(layer.areas ?? { [layer.name]: layer.modules }))
      for (const entry of entries) {
        const place = { layer: layer.name, at, area }
        const pattern = patternOf(entry)
        if (pattern) globs.push({ pattern, place })
        else exact.set(entry, place)
      }
  })
  return (path) => exact.get(path) ?? globs.find(({ pattern }) => pattern.test(path))?.place
}

/** `./x`, imported from `a/b.ts`: the path under the root of the module it names, where the table places it. */
export const targetOf = (placeOf, from, source) => {
  const parts = from.split('/').slice(0, -1)
  for (const part of source.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  const base = parts.join('/')
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find((path) => placeOf(path) !== undefined)
}

const tables = TABLES.map((table) => ({
  ...table,
  placeOf: placesOf(table),
  excepted: new Set(table.exceptions.map((exception) => `${exception.from} ${exception.to}`)),
}))

/** The table whose folder holds `filename`, and its path under that folder. */
const tableOf = (filename) => {
  const path = filename.replaceAll('\\', '/')
  for (const table of tables) {
    const at = path.lastIndexOf(`/${table.root}/`)
    if (at >= 0) return { table, path: path.slice(at + table.root.length + 2) }
  }
  return undefined
}

export const layers = defineRule({
  meta: {
    type: 'problem',
    messages: {
      unplaced: '{{path}} has no layer: place it in {{table}}, in the lowest layer whose modules it needs, beside the modules it is like.',
      upward:
        '{{path}}, in {{from}}, imports {{target}}, in {{to}} above it: move what it needs to a module of {{from}} or below, where that belongs, or {{path}} up, if it belongs there. A type alone is imported with import type.',
    },
  },
  create(context) {
    const found = tableOf(context.filename)
    if (found === undefined) return {}
    const { table, path } = found
    const here = table.placeOf(path)
    const check = (node) => {
      const source = node.source?.value
      if (here === undefined || typeof source !== 'string' || !source.startsWith('.')) return
      if (node.importKind === 'type' || node.exportKind === 'type') return
      const target = targetOf(table.placeOf, path, source)
      if (target === undefined) return
      const there = table.placeOf(target)
      if (there.at >= here.at || table.excepted.has(`${path} ${target}`)) return
      context.report({ node: node.source, messageId: 'upward', data: { path, from: here.layer, target, to: there.layer } })
    }
    return {
      Program(node) {
        if (here === undefined) context.report({ node, messageId: 'unplaced', data: { path, table: table.file } })
      },
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: (node) => node.source.type === 'Literal' && check(node),
    }
  },
})
