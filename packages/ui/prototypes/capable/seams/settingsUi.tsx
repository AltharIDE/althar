// Scrappy: the kit as Althar's Settings see it here: MCP servers, a section of its own before Skills, each the role table with its sync.
import type { ComponentProps } from 'react'

import { Button as RealButton } from '../../../src/primitives/Button/Button'
import { SettingsLayout as RealSettingsLayout } from '../../../src/setup/SettingsLayout/SettingsLayout'
import { SettingsNav as RealSettingsNav } from '../../../src/setup/SettingsNav/SettingsNav'
import { SkillInstall as RealSkillInstall, SkillList as RealSkillList } from '../../../src/setup/Skills/Skills'
import { ToolsByRole } from '../directions/tools/ToolsSettings'
import { useProto } from '../state'

export * from '../../../src/index'

const on = (p: ReturnType<typeof useProto>) => p.surface === 'tools' && p.direction !== 'Today'

export function SkillList(props: ComponentProps<typeof RealSkillList>) {
  const p = useProto()
  if (!on(p)) return <RealSkillList {...props} />
  return <ToolsByRole kind="skills" />
}

export function SkillInstall(props: ComponentProps<typeof RealSkillInstall>) {
  const p = useProto()
  return on(p) ? null : <RealSkillInstall {...props} />
}

export function Button(props: ComponentProps<typeof RealButton>) {
  const p = useProto()
  return on(p) && props.children === 'Check for updates' ? null : <RealButton {...props} />
}

export function SettingsLayout(props: ComponentProps<typeof RealSettingsLayout>) {
  if ((props.section as string) === 'mcp')
    return (
      <RealSettingsLayout {...props} title="MCP servers">
        <ToolsByRole kind="servers" />
      </RealSettingsLayout>
    )
  return <RealSettingsLayout {...props} />
}

export function SettingsNav<V extends string>(props: ComponentProps<typeof RealSettingsNav<V>>) {
  const p = useProto()
  if (!on(p)) return <RealSettingsNav {...props} />
  return (
    <RealSettingsNav
      {...props}
      groups={props.groups.map((group) =>
        group.flatMap((item) =>
          item.title === 'Skills' ? [{ id: 'mcp' as V, title: 'MCP servers', icon: 'plug' as const }, item] : [item],
        ),
      )}
    />
  )
}
