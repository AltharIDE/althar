// Scrappy, surface 3: Settings › MCP servers, and Settings › Skills, apart: each a table of what each role gets, and the switch that keeps the person's agents the same.
import { Checkbox } from 'radix-ui'
import { Fragment, useState } from 'react'

import { Icon } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Segmented } from '../../../../src/primitives/Segmented/Segmented'
import { VisuallyHidden } from '../../../../src/primitives/VisuallyHidden/VisuallyHidden'
import box from '../../../../src/primitives/CheckList/CheckList.module.css'
import { useProto } from '../../state'
import { type Found, type Reach, reachOf, ROLES, type Role, SERVERS, SKILLS, SOURCES, type SourceId } from './found'
import { KeepSkills, SkillMarks, useSkillSync } from './SkillSync'
import { AgentMarks, KeepSame, useSync } from './Sync'
import s from './tools.module.css'

export const toolsText = {
  servers: 'MCP servers',
  serversNote:
    'Found in your agents’ settings and the project’s .mcp.json. Every agent gets those switched on, whichever agent found them.',
  skills: 'Skills',
  skillsNote: 'Yours, your plugins’, the repository’s and Althar’s. Agents load the one that fits.',
  also: (names: string) => `Also in ${names}`,
  roles: 'Roles',
  projects: 'Projects',
  acts: 'Can post and change things',
  scope: 'For',
  every: 'Every project',
  role: 'Role',
  name: 'Server or skill',
}

const markOf = (found: Found) =>
  found.brand !== undefined ? (
    <BrandMark brand={found.brand} size={14} />
  ) : (
    <Icon name={SERVERS.includes(found) ? 'plug' : 'knowledge'} size={13} />
  )

const sourceMark = (id: SourceId) => {
  const source = SOURCES[id]
  return source.brand !== undefined ? (
    <BrandMark brand={source.brand} size={13} />
  ) : (
    <Icon name={id === 'project' || id === 'repository' ? 'folder' : 'knowledge'} size={12} />
  )
}

/** The reach each one has now, as switched on the page. */
const useReaches = () => {
  const [reaches, setReaches] = useState<Record<string, Reach>>({})
  const reach = (found: Found) => reaches[found.id] ?? reachOf(found)
  const set = (found: Found, next: Reach) => setReaches({ ...reaches, [found.id]: next })
  return { reach, set }
}

/** One table, a row each, a column for each role; above it, which project it is for. With sync, each server says which of your agents have it, and one switch keeps them the same. */
export function ToolsByRole({ kind }: { kind: 'servers' | 'skills' }) {
  const syncing = true
  const p = useProto()
  const { reach, set } = useReaches()
  const [scope, setScope] = useState<'every' | 'althar'>('every')
  const agents = useSync({ week: p.week, confirm: p.direction === 'A' })
  const skills = useSkillSync()
  const tick = (one: Found, role: Role) => {
    const now = reach(one)
    const inScope = scope === 'every' || now.projects.includes('althar')
    const on = now.roles.includes(role) && inScope && !p.off.includes(one.id)
    return (
      <Checkbox.Root
        checked={on}
        className={box.box}
        aria-label={`${ROLES.find((r) => r.id === role)!.plural} get ${one.name}`}
        onCheckedChange={(next) =>
          set(one, { ...now, roles: ROLES.map((r) => r.id).filter((id) => (id === role ? next === true : now.roles.includes(id))) })
        }
      >
        <Checkbox.Indicator className={box.tick}>
          <Icon name="check" size={10} />
        </Checkbox.Indicator>
      </Checkbox.Root>
    )
  }
  const rows = (list: ReadonlyArray<Found>) => (
    <>
      {list.map((one) => (
        <tr key={one.id}>
          <th scope="row" className={s.nameCell}>
            <div className={s.nameBox}>
              <span className={s.nameLine}>
                {markOf(one)}
                <span className={s.name}>{one.name}</span>
                {syncing && SERVERS.includes(one) ? (
                  <AgentMarks found={one} sync={agents} />
                ) : syncing ? (
                  <SkillMarks found={one} sync={skills} />
                ) : (
                  <span className={s.sources} title={one.sources.map((id) => `${SOURCES[id].name}: ${SOURCES[id].path}`).join('\n')}>
                    {one.sources.map((id) => (
                      <Fragment key={id}>{sourceMark(id)}</Fragment>
                    ))}
                  </span>
                )}
              </span>
              <span className={SERVERS.includes(one) ? s.runs : s.about}>{one.runs}</span>
            </div>
          </th>
          {ROLES.map((role) => (
            <td key={role.id} className={s.tick}>
              {tick(one, role.id)}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
  return (
    <div className={s.page}>
      <div className={s.scope}>
        <Segmented<'every' | 'althar'>
          label={toolsText.scope}
          value={scope}
          onChange={setScope}
          options={[
            { value: 'every', label: toolsText.every },
            { value: 'althar', label: 'althar' },
          ]}
        />
      </div>
      {kind === 'servers' ? <KeepSame sync={agents} /> : <KeepSkills sync={skills} />}
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col" className={s.corner}>
              <VisuallyHidden>{toolsText.name}</VisuallyHidden>
            </th>
            {ROLES.map((role) => (
              <th key={role.id} scope="col" className={s.roleHead}>
                {role.plural}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{kind === 'servers' ? rows(agents.servers) : rows(SKILLS)}</tbody>
      </table>
    </div>
  )
}
