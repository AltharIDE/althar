import type { ConnectionList } from '@althar/contracts'
import { BrandMark, Button, ControlLine, LinkButton, SettingGroup, SettingList, SettingRow, TrackerBinding } from '@althar/ui'

import { productBrand, productName } from '../../shared/products'
import { type Opening, openingFor } from '../connections/ConnectDialog'
import { serviceOfProduct } from '../connections/ways'
import { text as frontText, type Tracker } from '../project/front'
import { Repositories } from '../repositories/Repositories'
import { useRepositories } from '../repositories/useRepositories'
import s from './ProjectSettings.module.css'
import { HEADING } from './sections'
import { type Standing, standingOf } from './standing'
import { useProjectTracker } from './useProjectTracker'

/*
 * What a project's code and issues are: its repositories, where each is and
 * where its work goes, with the code hosts they push to; then the trackers
 * its tasks' issues are on, each by its mark as it is, saying who Althar is
 * there, or in violet that it isn't connected or is signed out, with the
 * button that connects it or signs in again. Above them, where its issues
 * go: one tracker connected, a workspace of Linear's say, and its team, or,
 * unset, where its issues already are (ADR-059). Connections are Althar's,
 * for every project: managing them is in Althar's own settings.
 */

export const text = {
  trackers: 'Trackers',
  connectTracker: 'Connect a tracker',
  none: 'No tracker yet',
  /** MER issues · Linear; a tracker whose issues share no key by its name alone: Trello cards. */
  issues: (tracker: Tracker) =>
    tracker.key === null ? frontText.issues(tracker) : `${frontText.issues(tracker)} · ${productName(tracker.product)}`,
  standing: {
    connected: (login: string) => `Connected as ${login}`,
    notConnected: 'Not connected',
    signedOut: (login: string) => `Signed out as ${login}`,
  },
  connect: 'Connect',
  signIn: 'Sign in again',
  openOn: (tracker: Tracker) => `Open on ${productName(tracker.product)}`,
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
  const standing = standingOf(list, tracker)
  const url = tracker.url
  // Signed out, the very connection its issues go through signs in again, whoever else is signed in there.
  const opening: Opening =
    standing.kind === 'signedOut'
      ? { service: serviceOfProduct(tracker.product), again: standing.connectionId }
      : openingFor(list, tracker.product, tracker.at)
  return (
    <SettingRow
      title={text.issues(tracker)}
      note={<StandingLine standing={standing} />}
      mark={<BrandMark brand={productBrand(tracker.product)} size={18} />}
    >
      {() =>
        standing.kind !== 'connected' ? (
          <Button size="small" variant="signal" onClick={() => onConnect(opening)}>
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
  const bound = useProjectTracker(projectId, list)
  return (
    <>
      <Repositories model={repositories} connections={list} onConnect={onConnect} />
      <SettingGroup
        title={text.trackers}
        headingLevel={HEADING.part}
        action={
          <Button size="small" icon="plug" onClick={() => onConnect('all')}>
            {text.connectTracker}
          </Button>
        }
      >
        <SettingList>
          {bound.trackers.length > 0 && (
            <TrackerBinding
              trackers={bound.trackers}
              value={bound.value}
              container={bound.container}
              containers={bound.containers}
              gone={bound.gone}
              onChange={bound.choose}
              onContainer={bound.chooseContainer}
            />
          )}
          {bound.failed !== null && (
            <p role="alert" className={s.quiet}>
              <ControlLine tone="yours">{bound.failed}</ControlLine>
            </p>
          )}
          {trackers.length === 0 ? (
            <SettingRow title={text.none}>{() => null}</SettingRow>
          ) : (
            trackers.map((tracker) => (
              <TrackerRow
                key={`${tracker.product}:${tracker.at ?? ''}:${tracker.key ?? ''}`}
                tracker={tracker}
                list={list}
                onConnect={onConnect}
              />
            ))
          )}
        </SettingList>
      </SettingGroup>
      <p className={s.quiet}>
        <LinkButton onClick={onManage}>{text.manage}</LinkButton>
      </p>
    </>
  )
}
