// Scrappy, surface 4: Settings › MCP servers and skills. A lists them by where they were found, each with a switch and who gets it; B is one table of what each role gets.
import { Checkbox } from 'radix-ui'
import { Fragment, useState } from 'react'

import { Icon } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Menu, MenuCheckboxItem, MenuGroup, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { Segmented } from '../../../../src/primitives/Segmented/Segmented'
import { VisuallyHidden } from '../../../../src/primitives/VisuallyHidden/VisuallyHidden'
import { Switch } from '../../../../src/primitives/Switch/Switch'
import { RuleWord } from '../../../../src/setup/Charter/Charter'
import { SettingGroup, SettingList, SettingRow } from '../../../../src/setup/Preferences/Preferences'
import box from '../../../../src/primitives/CheckList/CheckList.module.css'
import { proto, useProto } from '../../state'
import { type Found, PROJECTS, type Reach, reachOf, reachWords, ROLES, type Role, SERVERS, SKILLS, SOURCES, type SourceId } from './found'
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

/** Who gets it: a word that opens the roles and projects. */
function ReachWord({ found, reach, onChange }: { found: Found; reach: Reach; onChange: (reach: Reach) => void }) {
  return (
    <Menu label={`Who gets ${found.name}`} width={240} trigger={<RuleWord>{reachWords(reach)}</RuleWord>}>
      <MenuGroup label={toolsText.roles}>
        {ROLES.map((role) => (
          <MenuCheckboxItem
            key={role.id}
            keepOpen
            checked={reach.roles.includes(role.id)}
            onCheckedChange={(on) =>
              onChange({ ...reach, roles: ROLES.map((one) => one.id).filter((id) => (id === role.id ? on : reach.roles.includes(id))) })
            }
          >
            {role.plural}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup label={toolsText.projects}>
        {PROJECTS.map((project) => (
          <MenuCheckboxItem
            key={project}
            keepOpen
            checked={reach.projects.includes(project)}
            disabled={(found.sources[0] === 'project' || found.sources[0] === 'repository') && project !== 'althar'}
            onCheckedChange={(on) =>
              onChange({ ...reach, projects: PROJECTS.filter((one) => (one === project ? on : reach.projects.includes(one))) })
            }
          >
            {project}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
    </Menu>
  )
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

/** A: by where each was found, the config's name and path heading its group; one found twice is listed under the first. */
export function ToolsBySource() {
  const p = useProto()
  const { reach, set } = useReaches()
  const groups = (list: ReadonlyArray<Found>) =>
    (Object.keys(SOURCES) as SourceId[])
      .map((source) => ({ source, found: list.filter((one) => one.sources[0] === source) }))
      .filter((group) => group.found.length > 0)
  const section = (title: string, note: string, list: ReadonlyArray<Found>) => (
    <SettingGroup title={title} note={note} headingLevel={3}>
      {groups(list).map(({ source, found }) => (
        <Fragment key={source}>
          <p className={s.source}>
            {sourceMark(source)}
            <span className={s.sourceName}>{SOURCES[source].name}</span>
            <code className={s.path}>{SOURCES[source].path}</code>
          </p>
          <SettingList>
            {found.map((one) => {
              const on = !p.off.includes(one.id)
              return (
                <SettingRow
                  key={one.id}
                  title={one.name}
                  mark={markOf(one)}
                  note={
                    <span className={s.note}>
                      <span className={SERVERS.includes(one) ? s.runs : s.about}>{one.runs}</span>
                      {one.sources.length > 1 && (
                        <span>
                          {toolsText.also(
                            one.sources
                              .slice(1)
                              .map((id) => SOURCES[id].name)
                              .join(', '),
                          )}
                        </span>
                      )}
                    </span>
                  }
                  className={on ? undefined : s.off}
                >
                  {(ids) => (
                    <span className={s.control}>
                      {on && <ReachWord found={one} reach={reach(one)} onChange={(next) => set(one, next)} />}
                      <Switch checked={on} onChange={() => proto.toggle(one.id)} {...ids} />
                    </span>
                  )}
                </SettingRow>
              )
            })}
          </SettingList>
        </Fragment>
      ))}
    </SettingGroup>
  )
  return (
    <div className={s.page}>
      {section(toolsText.servers, toolsText.serversNote, SERVERS)}
      {section(toolsText.skills, toolsText.skillsNote, SKILLS)}
    </div>
  )
}

/** B: one table, a row each, a column for each role; above it, which project it is for. */
export function ToolsByRole() {
  const p = useProto()
  const { reach, set } = useReaches()
  const [scope, setScope] = useState<'every' | 'althar'>('every')
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
  const rows = (title: string, list: ReadonlyArray<Found>) => (
    <>
      <tr className={s.groupRow}>
        <th scope="rowgroup" colSpan={4}>
          {title}
        </th>
      </tr>
      {list.map((one) => (
        <tr key={one.id}>
          <th scope="row" className={s.nameCell}>
            <div className={s.nameBox}>
              <span className={s.nameLine}>
                {markOf(one)}
                <span className={s.name}>{one.name}</span>
                <span className={s.sources} title={one.sources.map((id) => `${SOURCES[id].name}: ${SOURCES[id].path}`).join('\n')}>
                  {one.sources.map((id) => (
                    <Fragment key={id}>{sourceMark(id)}</Fragment>
                  ))}
                </span>
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
        <tbody>
          {rows(toolsText.servers, SERVERS)}
          {rows(toolsText.skills, SKILLS)}
        </tbody>
      </table>
    </div>
  )
}
