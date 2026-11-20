import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The usage lab: the whole desktop app (its router, tabs and screens) on
 * made-up data with no runtime, with a fifth view in a project's header,
 * Usage, after Artifacts. Three small seams in the source as it is served
 * (the kit's Room, its view switch, and the project's screen) put it there;
 * each direction draws the view's page (lab/usage/README.md).
 */

const here = import.meta.dirname
const ui = join(here, '../../../../packages/ui/src')

/** A file's text, changed where it says: each seam names the words it replaces, and fails loudly where they've gone. */
const SEAMS: ReadonlyArray<{ readonly file: string; readonly swaps: ReadonlyArray<readonly [string, string]> }> = [
  {
    file: join(ui, 'foundations/vocabulary.ts'),
    swaps: [["Artifacts = 'artifacts',", "Artifacts = 'artifacts',\n  Usage = 'usage',"]],
  },
  {
    file: join(ui, 'chrome/RoomSwitch/RoomSwitch.tsx'),
    swaps: [
      ["[Room.Artifacts]: 'Artifacts',", "[Room.Artifacts]: 'Artifacts',\n    [Room.Usage]: 'Usage',"],
      ['Room.Artifacts, Room.Settings] as const', 'Room.Artifacts, Room.Usage, Room.Settings] as const'],
    ],
  },
  {
    file: join(here, '../../src/renderer/features/project/ProjectView.tsx'),
    swaps: [
      [
        ') : room === Room.Artifacts ? (',
        ') : room === Room.Usage ? (\n<LabUsage projectId={projectId} />\n) : room === Room.Artifacts ? (',
      ],
      [
        "import { MessageMotion } from '../../shared/MessageMotion'",
        "import { LabUsage } from '@lab-usage'\nimport { MessageMotion } from '../../shared/MessageMotion'",
      ],
    ],
  },
]

const seam = (): Plugin => ({
  name: 'usage-lab:seam',
  enforce: 'pre',
  transform(code, id) {
    const one = SEAMS.find((each) => each.file === id.split('?')[0])
    if (one === undefined) return null
    let out = code
    for (const [from, to] of one.swaps) {
      if (!out.includes(from)) throw new Error(`usage lab: "${from}" is no longer in ${one.file}; the seam needs updating`)
      out = out.replace(from, to)
    }
    return out
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  resolve: {
    alias: {
      '@lab-usage': join(here, 'page.tsx'),
      // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
      vitest: join(here, 'vitest.ts'),
      '@althar/testing': join(here, 'testing.ts'),
    },
  },
  server: { port: 6188, strictPort: true },
})
