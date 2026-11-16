import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The homes lab: the whole desktop app (its router, tabs and screens) on
 * made-up data with no runtime, in a window for this computer and one for
 * each home opened, with what #982 draws for homes swapped for each
 * direction's by a few import seams (lab/homes/README.md):
 *
 * - features/homes/HomeConnections.tsx, wherever the app imports it, is the
 *   lab's (seam/HomeConnections.tsx), which draws the direction's;
 * - the kit, as TabsFrame.tsx takes it, is seam/ui.ts, whose ProjectTabs
 *   names the home in its first tab where a direction does;
 * - the kit's screens, as HomeView.tsx takes them, are seam/screens.ts, whose
 *   Home has the homes under it where a direction puts them there;
 * - StartView.tsx's empty remote home is the direction's (seam/Empty.tsx).
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const connections = join(renderer, 'features/homes/HomeConnections.tsx')
const tabsFrame = join(renderer, 'features/tabs/TabsFrame.tsx')
const homeView = join(renderer, 'features/home/HomeView.tsx')
const startView = join(renderer, 'features/start/StartView.tsx')
const inLab = (id: string | undefined) => id !== undefined && id.startsWith(here)
const bare = (id: string | undefined) => id?.split('?')[0] ?? ''

const seam = (): Plugin => ({
  name: 'homes-lab:seam',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (importer === undefined || inLab(importer)) return null
    if (source === '@althar/ui' && bare(importer) === tabsFrame) return join(here, 'seam/ui.ts')
    if (source === '@althar/ui/screens' && bare(importer) === homeView) return join(here, 'seam/screens.ts')
    if (!source.includes('HomeConnections')) return null
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
    return resolved !== null && bare(resolved.id) === connections ? join(here, 'seam/HomeConnections.tsx') : null
  },
  transform(code, id) {
    if (bare(id) !== startView) return null
    // The remote home with no projects: the direction's, in the same place.
    const from = code.indexOf('<main className={s.remoteEmpty}>')
    const to = code.indexOf('</main>', from)
    if (from < 0 || to < 0) throw new Error('homes lab: StartView no longer has its remote empty state where the seam looks')
    return `import { RemoteEmpty as LabRemoteEmpty } from ${JSON.stringify(join(here, 'seam/Empty.tsx'))}\n${code.slice(0, from)}<LabRemoteEmpty />${code.slice(to + '</main>'.length)}`
  },
})

// The kit's icons, for the lab's own drawings of a home and this computer.
const iconoir = dirname(dirname(createRequire(join(here, '../../../../packages/ui/package.json')).resolve('iconoir-react')))

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: {
    alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts'), 'iconoir-react': iconoir },
  },
  server: { port: 6181, strictPort: true },
})
