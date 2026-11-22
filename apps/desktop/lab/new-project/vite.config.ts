import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The new project lab: the whole desktop app (its router, tabs and screens)
 * on a made-up home with no runtime, where each direction starts and runs
 * making a project (README.md). Four seams, all here:
 *
 * - the start route's StartView is the lab's, which draws a home with no
 *   projects as the direction has it, and is the app's own otherwise;
 * - the New project route's NewProjectView is the lab's, the direction's
 *   page in the New project tab;
 * - the tab bar's + and ⌘N go through the lab, which opens the direction's
 *   flow, on a remote home too (today, Manage homes);
 * - Manage homes' line for a home with no projects offers New project;
 * - the Settings page groups its side by whose each section is, says so in
 *   each section's line, and shows what the home lacks over the side
 *   (settings.tsx), unless the bar asks for today's.
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const swapped = new Map([
  [`${join(renderer, 'features/start/route.tsx')}|./StartView`, join(here, 'StartView.tsx')],
  [`${join(renderer, 'features/newProject/route.tsx')}|./NewProjectView`, join(here, 'NewProjectView.tsx')],
])
const entries = join(here, 'entries.tsx')
const settings = join(here, 'settings.tsx')

/** Replaces `from` in `code`, and fails the build where it isn't there, so a seam that no longer fits says so. */
const swap = (code: string, from: string, to: string, file: string) => {
  if (!code.includes(from)) throw new Error(`The lab's seam no longer fits ${file}: ${from}`)
  return code.replaceAll(from, to)
}

const seams = (): Plugin => ({
  name: 'new-project-lab:seams',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer === undefined) return null
    return swapped.get(`${importer.split('?')[0]}|${source}`) ?? null
  },
  transform(code, id) {
    const file = id.split('?')[0] ?? ''
    if (file.endsWith('features/tabs/TabsFrame.tsx')) {
      let next = swap(code, 'client.connection === undefined ? tabs.newProject : showHomes', '__labNew(tabs.newProject)', file)
      next = swap(next, 'client.connection === undefined ? createProject : showHomes', '__labNew(createProject)', file)
      return `import { labNew as __labNew } from '${entries}'\n${next}`
    }
    if (file.endsWith('features/settings/SettingsPage.tsx')) {
      let next = swap(code, 'const open = sectionText[section]', 'const open = __textOf(sectionText)[section]', file)
      next = swap(next, 'title={open.title}', 'title={open.title} lede={__ledeOf(section)}', file)
      next = swap(
        next,
        '<QuickCards side preferences={preferences} sounds={sounds.list} onSection={onSection} />',
        '<__HomeCard />{__quickCards() && <QuickCards side preferences={preferences} sounds={sounds.list} onSection={onSection} />}',
        file,
      )
      next = swap(next, '<SettingsNav\n', '<__ScopedNav\n', file)
      next = swap(next, 'groups={GROUPS.map((group) =>', 'groups={__groupsOf(GROUPS).map((group) =>', file)
      next = swap(next, 'title: sectionText[id].title,', 'title: __textOf(sectionText)[id].title,', file)
      return `import { groupsOf as __groupsOf, HomeCard as __HomeCard, ledeOf as __ledeOf, quickCards as __quickCards, ScopedNav as __ScopedNav, textOf as __textOf } from '${settings}'\n${next}`
    }
    if (file.endsWith('features/homes/ManageHomes.tsx')) {
      const next = swap(
        code,
        "return <p className={s.empty}>{local ? 'Add a project and it shows here.' : 'Add a project on the host and it shows here.'}</p>",
        "return <__LabShelfEmpty local={local} onNew={() => onOpen('__new__')} />",
        file,
      )
      return `import { LabShelfEmpty as __LabShelfEmpty } from '${entries}'\n${next}`
    }
    return null
  },
})

export default defineConfig({
  root: here,
  plugins: [seams(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6188, strictPort: true },
})
