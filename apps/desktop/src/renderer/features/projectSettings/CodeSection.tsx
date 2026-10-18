import type { ConnectionList } from '@althar/contracts'
import { BrandMark, Button, ControlLine, LinkButton, SettingGroup, SettingList, SettingRow } from '@althar/ui'

import { productBrand, productName } from '../../shared/products'
import { type Opening, openingFor } from '../connections/ConnectDialog'
import type { Tracker } from '../project/front'
import { Repositories } from '../repositories/Repositories'
import { useRepositories } from '../repositories/useRepositories'
import s from './ProjectSettings.module.css'
import { HEADING } from './sections'
import { type Standing, standingOf } from './standing'

/*
 * What a project's code and issues are: its repositories, where each is and
 * where its work goes, with the code hosts they push to; then the trackers
 * its tasks' issues are on, each by its mark as it is, saying who Althar is
 * there, or in violet what can't happen until the person connects it or
 * signs in again, with the button that does. Connections are Althar's, for
 * every project: managing them is in Althar's own settings.
 */

export const text = {
  trackers: 'Trackers',
  trackersNote: 'Where its tasks’ issues are. The coordinator starts tasks from them, and they move as the work starts.',
  connectTracker: 'Connect a tracker',
  none: 'No tracker yet',
  noneNote: 'None of its tasks has started from an issue. Connect a tracker, and the coordinator can start tasks from its issues.',
  issues: (tracker: Tracker) => `${productName(tracker.product)} · ${tracker.key} issues`,
  standing: {
    connected: (login: string) => `Connected as ${login}`,
    notConnected: 'Not connected: Althar can’t read its issues, or move them as their tasks start.',
    signedOut: (login: string) => `Signed out as ${login}: Althar can’t read its issues, or move them, until you sign in again.`,
  },
  connect: 'Connect',
  signIn: 'Sign in again',
  openOn: (tracker: Tracker) => `Open on ${productName(tracker.product)}`,
  appWide: 'Connections are Althar’s, not the project’s: a code host or tracker connected once is there for every project.',
  manage: 'Manage connections',
}

/** Where Althar stands there, in a line: who it is, or in violet what can't happen. */
function StandingLine({ standing }: { standing: Standing }) {
  switch (standing.kind) {
    case 'connected':
      return <>{text.standing.connected(standing.login)}</>
    case 'notConnected':
      return <ControlLine tone="yours">{text.standing.notConnected}</ControlLine>
    case 'signedOut':
      return <ControlLine tone="yours">{text.standing.signedOut(standing.login)}</ControlLine>
  }
}

function TrackerRow({
  tracker,
  list,
  onConnect,
}: {
  tracker: Tracker
  list: ConnectionList | null
  onConnect: (opening: Opening) => void
}) {
  const standing = standingOf(list, tracker.product, tracker.at)
  const url = tracker.url
  return (
    <SettingRow
      title={text.issues(tracker)}
      note={<StandingLine standing={standing} />}
      mark={<BrandMark brand={productBrand(tracker.product)} size={18} />}
    >
      {() =>
        standing.kind !== 'connected' ? (
          <Button size="small" variant="signal" onClick={() => onConnect(openingFor(list, tracker.product, tracker.at))}>
            {standing.kind === 'signedOut' ? text.signIn : text.connect}
          </Button>
        ) : url === null ? null : (
          // The window opens web pages in the person's browser.
          <LinkButton onClick={() => void window.open(url, '_blank')}>{text.openOn(tracker)}</LinkButton>
        )
      }
    </SettingRow>
  )
}

export function CodeSection({
  projectId,
  trackers,
  list,
  onConnect,
  onManage,
}: {
  projectId: string
  /** The trackers its tasks' issues are on, the one most of them name first. */
  trackers: ReadonlyArray<Tracker>
  /** The code hosts and trackers connected, and those Althar knows. */
  list: ConnectionList | null
  /** Connects a code host or tracker, over the page. */
  onConnect: (opening: Opening) => void
  /** Althar's own settings, at its code hosts and trackers. */
  onManage: () => void
}) {
  const repositories = useRepositories(projectId)
  return (
    <>
      <Repositories model={repositories} connections={list} onConnect={onConnect} />
      <SettingGroup
        title={text.trackers}
        headingLevel={HEADING.part}
        note={text.trackersNote}
        action={
          <Button size="small" icon="plug" onClick={() => onConnect('all')}>
            {text.connectTracker}
          </Button>
        }
      >
        <SettingList>
          {trackers.length === 0 ? (
            <SettingRow title={text.none} note={text.noneNote}>
              {() => null}
            </SettingRow>
          ) : (
            trackers.map((tracker) => (
              <TrackerRow
                key={`${tracker.product}:${tracker.at ?? ''}:${tracker.key}`}
                tracker={tracker}
                list={list}
                onConnect={onConnect}
              />
            ))
          )}
        </SettingList>
      </SettingGroup>
      <p className={s.quiet}>
        {text.appWide} <LinkButton onClick={onManage}>{text.manage}</LinkButton>
      </p>
    </>
  )
}
