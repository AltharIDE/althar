import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * with "allow everything" drawn five ways over today's. Nothing in the app or
 * the kit changes on disk. Two things do it, for this server alone:
 *
 * - seams swap one import of a real screen for the prototype's: what the task
 *   screen and the board take from the kit (TaskHeader, Composer, BoardCard,
 *   wrapped), and the task's permission calls (wrapped, to say what cleared);
 * - patches add a slot to three kit components as they are served, so a path
 *   can put its own line, option or control inside them: the permission card,
 *   the task menu and the rules screen. With today's path the slots are empty
 *   and each component is as it ships.
 *
 * Plain JavaScript, so no type check takes it in.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const seams = [
  { importer: 'features/task/TaskView.tsx', id: '@althar/ui', to: 'seams/taskUi.tsx' },
  { importer: 'features/task/TaskView.tsx', id: './PermissionCall', to: 'seams/PermissionCall.tsx' },
  { importer: 'features/board/BoardView.tsx', id: '@althar/ui', to: 'seams/boardUi.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'allow-everything-seams',
  enforce: 'pre',
  resolveId(id, importer) {
    const seam = seams.find((one) => one.id === id && importer?.split('?')[0]?.endsWith(one.importer))
    return seam === undefined ? null : resolve(here, seam.to)
  },
}

/** Each patch: the kit file, and the text it finds and what it puts in its place. A patch that finds nothing stops the page. */
const patches = [
  {
    file: 'packages/ui/src/thread/Permission/Permission.tsx',
    edits: [
      [
        "import s from './Permission.module.css'",
        "import s from './Permission.module.css'\nimport { useCardSlot as __useCardSlot } from '@proto/slots'",
      ],
      ['function Card({\n  what,', 'function Card({\n  id: __id,\n  what,'],
      [
        '...(allowed ? { scopes: allowed } : {}) })\n  const [pick, setPick]',
        // The path's answer goes after the card's yeses, before its noes, and takes the next key.
        "...(allowed ? { scopes: allowed } : {}) })\n  const __slot = __useCardSlot({ id: __id, what, cmd, kind, pos, total })\n  const __list: Decision[] = __slot?.extra ? [...offers.filter((d) => !refuses(d)), '__extra' as Decision, ...offers.filter((d) => refuses(d))] : offers\n  const [pick, setPick]",
      ],
      ['const no = refuses(pick)', "const no = (pick as string) === '__extra' ? false : refuses(pick)"],
      [
        'if (!phase) onAnswer(answer())',
        "if (!phase) {\n            if ((pick as string) === '__extra' && __slot?.extra) {\n              onAnswer({ decision: Decision.AllowOnce, cmd })\n              __slot.extra.onChoose()\n              return\n            }\n            onAnswer(answer())\n          }",
      ],
      ['const d = offers[Number(e.key) - 1]', 'const d = __list[Number(e.key) - 1]'],
      [
        '{offers.map((d, i) => (\n',
        '{__list.map((d, i) => (d as string) === \'__extra\' && __slot?.extra ? (\n            <div key="__extra" className={cx(s.option, pick === d && s.on)}>\n              <label className={s.optionLabel}>\n                <input type="radio" name={name} className={s.radio} checked={pick === d} onChange={() => setPick(d)} />\n                <span className={s.key} aria-hidden="true">{i + 1}</span>\n                <span>{__slot.extra.label}</span>\n              </label>\n              {__slot.extra.beside}\n              {pick === d && __slot.extra.under}\n            </div>\n          ) : (\n',
      ],
      ['          ))}\n        </fieldset>', '          ))}\n        </fieldset>\n        {__slot?.note}'],
      ['{no ? t.deny : t.allow}', "{(pick as string) === '__extra' && __slot?.extra ? __slot.extra.button : no ? t.deny : t.allow}"],
      ['{t.keys(offers.length)}', '{t.keys(__list.length)}'],
    ],
  },
  {
    file: 'packages/ui/src/chrome/TaskMenu/TaskMenu.tsx',
    edits: [
      [
        "import s from './TaskMenu.module.css'",
        "import s from './TaskMenu.module.css'\nimport { useMenuSlot as __useMenuSlot } from '@proto/slots'",
      ],
      ['const t = { ...taskMenuText, ...text }\n', 'const t = { ...taskMenuText, ...text }\n  const __slot = __useMenuSlot()\n'],
      [
        '      {onAbandon && (\n        <>\n          {(opens',
        '      {__slot.items}\n      {onAbandon && (\n        <>\n          {(opens',
      ],
      // Open as the page says, so a card's way out can open it.
      [
        '      open={open}\n      defaultOpen={defaultOpen}\n      onOpenChange={onOpenChange}',
        '      open={__slot.open}\n      onOpenChange={__slot.onOpenChange}',
      ],
    ],
  },
  {
    file: 'packages/ui/src/screens/ProjectRules/ProjectRules.tsx',
    edits: [
      [
        "import s from './ProjectRules.module.css'",
        "import s from './ProjectRules.module.css'\nimport { useRulesSlot as __useRulesSlot } from '@proto/slots'",
      ],
      ['const t = { ...projectRulesText, ...text }\n', 'const t = { ...projectRulesText, ...text }\n  const __slot = __useRulesSlot()\n'],
      ['      </header>\n\n      <Charter>', '      </header>\n      {__slot}\n\n      <Charter>'],
    ],
  },
]

/** @type {import('vite-plus').Plugin} */
const patch = {
  name: 'allow-everything-patches',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0]
    const one = patches.find((each) => file === resolve(repo, each.file))
    if (one === undefined) return null
    let out = code
    for (const [find, put] of one.edits) {
      if (!out.includes(find)) throw new Error(`allow-everything: ${one.file} no longer has ${JSON.stringify(find.slice(0, 60))}`)
      out = out.replace(find, put)
    }
    return { code: out, map: null }
  },
}

export default defineConfig({
  root: here,
  plugins: [swap, patch, react()],
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: resolve(here, 'vi.ts') },
      { find: /^@proto\/(.*)$/, replacement: `${here}/$1` },
    ],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5361, strictPort: true, fs: { allow: [repo] } },
})
