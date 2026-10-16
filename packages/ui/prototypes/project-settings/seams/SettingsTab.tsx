// Scrappy: the Settings tab's side and sheet. In E, the projects are a group of its sections, and althar's opens on the tab's own sheet.
import { Panel as RealPanel, type PanelProps, SettingsNav as RealNav, type SettingsNavProps } from '../../../src/index'
import { EProjectSection } from '../directions/E'
import { useThings } from '../parts'
import { proto, useProto } from '../state'

const ALTHAR = 'project:althar'
const SITE = 'project:charrette-site'

export function SettingsNav<V extends string>(props: SettingsNavProps<V>) {
  const p = useProto()
  const things = useThings()
  if (p.direction !== 'E') return <RealNav {...props} />
  type W = V | typeof ALTHAR | typeof SITE
  const projects = [
    { id: ALTHAR as W, title: 'althar', icon: 'folder' as const, ...(things.troubles > 0 ? { yours: true } : {}) },
    { id: SITE as W, title: 'charrette-site', icon: 'folder' as const },
  ]
  const [first, ...rest] = props.groups
  return (
    <RealNav<W>
      label={props.label}
      groups={[first ?? [], projects, ...rest]}
      value={p.inSettings ? ALTHAR : props.value}
      onChange={(id) => {
        if (id === ALTHAR || id === SITE) return proto.set({ inSettings: true })
        proto.set({ inSettings: false })
        props.onChange(id as V)
      }}
    />
  )
}

export function Panel(props: PanelProps) {
  const p = useProto()
  if (p.direction !== 'E' || !p.inSettings || props.headingLevel !== 1) return <RealPanel {...props} />
  return (
    <RealPanel title="althar" lede="This project’s settings, for every task in it." headingLevel={1}>
      <EProjectSection />
    </RealPanel>
  )
}
