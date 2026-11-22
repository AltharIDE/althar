import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The What's new lab: the whole desktop app (its router, tabs and screens) on
 * made-up data with no runtime, right after Althar restarted into 0.10.0,
 * with Althar's own tab and its page (lab/whats-new/README.md). Two seams,
 * and the rest is the app's own:
 *
 * - the window's bar, the quick settings and Settings take the kit through
 *   ui.ts, which gives the bar Althar's tab (LabTabs.tsx) and points the
 *   version line's What's new into the app (LabVersion.tsx);
 * - ProjectTabs is the kit's own, with one more pinned tab after Settings'
 *   (`whatsNew`), drawn as Settings' tab is: the transform below adds it.
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const seamed = new Set([
  join(renderer, 'features/tabs/TabsFrame.tsx'),
  join(renderer, 'features/settings/QuickSettings.tsx'),
  join(renderer, 'features/settings/SettingsPage.tsx'),
])

const seam = (): Plugin => ({
  name: 'whats-new-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    const from = importer?.split('?')[0] ?? ''
    if (source === '@althar/ui' && seamed.has(from)) return join(here, 'ui.ts')
    return null
  },
})

/** A pinned tab of Althar's own after Settings', as the settings' tab is drawn: its mark, its name, and a dot. */
const WHATS_NEW_TAB = `
          {whatsNew !== undefined && (
            <li className={cx(s.tab, s.project, whatsNew.current && s.current)}>
              <button type="button" className={s.select} aria-current={whatsNew.current ? 'page' : undefined} onClick={whatsNew.onSelect}>
                {whatsNew.mark(s.logo)}
                <span className={s.name}>{whatsNew.name}</span>
                {whatsNew.dot === true && <span className={s.yours} data-lab-news="" aria-hidden="true" />}
              </button>
            </li>
          )}`

const swap = (code: string, from: string, to: string) => {
  if (!code.includes(from)) throw new Error(`whats-new lab: ProjectTabs.tsx no longer has ${JSON.stringify(from.slice(0, 60))}`)
  return code.replace(from, to)
}

const tabs = (): Plugin => ({
  name: 'whats-new-lab:tab',
  enforce: 'pre',
  transform(code, id) {
    if (!id.split('?')[0]?.endsWith('chrome/ProjectTabs/ProjectTabs.tsx')) return null
    let next = swap(code, '  pages,\n  onOpen,', '  pages,\n  whatsNew,\n  onOpen,')
    next = swap(
      next,
      '(pages ?? []).some((page) => page.current)',
      '(pages ?? []).some((page) => page.current) || whatsNew?.current === true',
    )
    next = swap(
      next,
      'onClick={settings.onClose} />\n            </li>\n          )}',
      `onClick={settings.onClose} />\n            </li>\n          )}${WHATS_NEW_TAB}`,
    )
    return { code: next, map: null }
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), tabs(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6183, strictPort: true },
})
