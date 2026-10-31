import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * opened on a project's settings. A few lines of the real screens are
 * patched as they load, so each direction's view of a repository's recorded
 * setup sits where it would: in Running (A, B) or as a section of its own
 * (C). Nothing in the app's own files changes.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const folders = resolve(here, 'Folders.tsx')

/** Each patch: the file it is in, what it replaces, and with what. */
const patches = [
  {
    file: 'features/projectSettings/RunningSection.tsx',
    edits: [
      [/^/, `import { ProtoFolders } from '${folders}'\n`],
      ['<SettingGroup title={text.where}', '<ProtoFolders where="running" />\n      <SettingGroup title={text.where}'],
    ],
  },
  {
    file: 'features/projectSettings/ProjectSettingsPage.tsx',
    edits: [
      [/^/, `import { ProtoFolders, protoGroups, useProtoDirection } from '${folders}'\n`],
      ['PROJECT_GROUPS.map(', 'protoGroups().map('],
      ['  const [connecting, setConnecting]', '  useProtoDirection()\n  const [connecting, setConnecting]'],
      [
        "    case 'notes':",
        "    // @ts-expect-error the prototype's section\n    case 'folders':\n      return <ProtoFolders where=\"section\" />\n    case 'notes':",
      ],
    ],
  },
  {
    file: 'features/projectSettings/sections.ts',
    edits: [
      ["['general', 'code', 'rules', 'running', 'notes'] as const", "['general', 'code', 'rules', 'running', 'folders', 'notes'] as const"],
      [
        "  notes: { title: 'Notes', icon: 'quote' },",
        "  notes: { title: 'Notes', icon: 'quote' },\n  folders: { title: 'Task folders', icon: 'folder' },",
      ],
    ],
  },
]

/** @type {import('vite-plus').Plugin} */
const patch = {
  name: 'task-setup-patches',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0] ?? ''
    const found = patches.find((one) => file.endsWith(one.file))
    if (found === undefined) return null
    let out = code
    for (const [from, to] of found.edits) {
      if (typeof from === 'string' && !out.includes(from)) throw new Error(`${found.file} no longer has ${from}`)
      out = out.replace(from, to)
    }
    return out
  },
}

export default defineConfig({
  root: here,
  plugins: [patch, react()],
  resolve: {
    alias: [{ find: /^vitest$/, replacement: resolve(here, 'vi.ts') }],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // Polling, so a server started inside the sandbox still sees edits.
  server: { port: 5476, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
