import type { SettingsNavProps } from '@althar/ui'
import { SettingsNav } from '@althar/ui'

import type { Section } from '../../src/renderer/features/settings/sections'
import { HomeReady, useNeeds } from './directions/parts'
import l from './lab.module.css'
import { lab } from './state'
import { HOME } from './world'

/*
 * Settings on a home, as proposed (S on the bar turns it back to today's).
 * The same page and sections, grouped down the side by whose each is: yours
 * (how work goes: tasks and presets, pull requests, MCP servers, skills, the
 * models you choose), the same on every home and kept in step, as an account
 * will keep them once there's a cloud; the home's own (who's signed in there,
 * the code hosts connected there, how much it runs at once); and this Mac's,
 * the window's, whichever home it's on. Each section's line says which. On a
 * home that lacks something work needs, a card over the side says what, with
 * the press that does it from this Mac.
 */

const proposed = () => lab.get().settings === 'proposed'

const YOURS_SECTIONS: readonly Section[] = ['tasks', 'pull-requests', 'mcp-servers', 'skills']
const HOMES: readonly Section[] = ['agents', 'code-hosts', 'this-mac']
const WINDOWS: readonly Section[] = ['notifications', 'appearance', 'editor-and-browser']

/** The quick switches over the side are all this Mac's (keep it awake, its notifications and sound): on another home, they're in This Mac's sections. */
export const quickCards = () => !proposed() || !HOME.remote

/** The side's groups: by whose, where proposed. */
export const groupsOf = (groups: ReadonlyArray<ReadonlyArray<Section>>): ReadonlyArray<ReadonlyArray<Section>> => {
  if (!proposed()) return groups
  return HOME.remote ? [YOURS_SECTIONS, HOMES, WINDOWS, ['about']] : [YOURS_SECTIONS, [...HOMES, ...WINDOWS], ['about']]
}

/** What each group is, over it. */
const scopes = (): ReadonlyArray<{ title: string; note?: string } | null> =>
  HOME.remote
    ? [{ title: 'Yours', note: 'every home' }, { title: HOME.name }, { title: 'This Mac', note: 'its windows' }, null]
    : [{ title: 'Yours', note: 'every home' }, { title: 'This Mac' }, null]

/** The sections' names: the home's work is the home's, by its name. */
export const textOf = <T extends Record<Section, { readonly title: string }>>(text: T): T =>
  proposed() ? { ...text, 'this-mac': { ...text['this-mac'], title: `Work on ${HOME.remote ? HOME.name : 'this Mac'}` } } : text

/** Each section's line: whose it is, and so where a change to it shows. */
export const ledeOf = (section: Section): string | undefined => {
  if (!proposed()) return undefined
  if (section === 'mcp-servers') return `Yours, on every home. Each runs where the work is; one that needs something there says so.`
  if (YOURS_SECTIONS.includes(section)) return `Yours, on every home. Kept in step with your other homes.`
  if (!HOME.remote) return section === 'agents' ? 'Signed in on this Mac. The models you choose are yours, on every home.' : undefined
  if (section === 'agents') return `Signed in on ${HOME.name}. The models you choose are yours, on every home.`
  if (section === 'code-hosts') return `Connected on ${HOME.name}, each as you, approved from this Mac.`
  if (section === 'this-mac') return `${HOME.name}’s own.`
  if (WINDOWS.includes(section)) return `This Mac’s, whichever home its window is on.`
  return undefined
}

/** The side's sections, with whose each group is over it, where proposed. */
export function ScopedNav<V extends string>(props: SettingsNavProps<V>) {
  if (!proposed()) return <SettingsNav {...props} />
  const over = scopes()
  return (
    <div className={l.scoped}>
      {props.groups.map((group, at) => {
        const scope = over[at] ?? null
        return (
          <div key={group.map((one) => one.id).join(' ')}>
            {scope !== null && (
              <p className={l.scope}>
                {scope.title}
                {scope.note !== undefined && <span> · {scope.note}</span>}
              </p>
            )}
            <SettingsNav {...props} groups={[group]} label={scope === null ? props.label : `${props.label}: ${scope.title}`} />
          </div>
        )
      })}
    </div>
  )
}

/** Over the side, on a home that lacks something work needs: what, with the press that does it. */
export function HomeCard() {
  const needs = useNeeds()
  if (!proposed() || !HOME.remote) return null
  const missing = needs.filter((one) => one.state !== 'there')
  return (
    <section className={l.homeCard} aria-label={HOME.name}>
      <p className={l.homeTitle}>{HOME.name}</p>
      <p className={l.homeLine}>
        Has your settings, in step with this Mac.
        {missing.length === 0 ? ' And all its work needs.' : ''}
      </p>
      {missing.length > 0 && <HomeReady label={`Missing on ${HOME.name}`} only={missing.map((one) => one.key)} yours={false} compact />}
    </section>
  )
}
