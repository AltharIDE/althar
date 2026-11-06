// Scrappy: the kit, as Settings sees it here: its Browser section drawn in the page's own layout.
import { SettingsLayout as Built, type SettingsLayoutProps } from '../../../src/setup/SettingsLayout/SettingsLayout'
import { BrowserSettings } from '../parts/BrowserSettings'

export * from '../../../src/index'

export function SettingsLayout(props: SettingsLayoutProps) {
  if (props.section !== 'browser') return <Built {...props} />
  return (
    <Built {...props}>
      <BrowserSettings />
    </Built>
  )
}
