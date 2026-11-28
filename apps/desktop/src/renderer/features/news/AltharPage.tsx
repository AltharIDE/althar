import { useEffect } from 'react'

import { Heading, Logo, TaskHeader, TaskStatus, TitleBar } from '@althar/ui'
import { ComingNext, WhatsNew, type WhatsNewFeature, YourWorkers } from '@althar/ui/screens'

import { CHANGELOG, COMMUNITY, ISSUES } from '../../shared/links'
import { useUpdate } from '../../shared/useUpdate'
import { alsoOf, betterOf, featuresOf, FOLLOW, leadOf, RELEASES, roadmapOf, type Way } from './notes'
import s from './AltharPage.module.css'
import { useNews } from './useNews'

/*
 * Althar's own page, a tab like a project's: its bar, saying whether this is
 * the newest Althar, and its two views. What's new, this release on the light,
 * from the version the person updated from; Coming next, the roadmap for them
 * to shape. Opening it is looking at the update.
 */

export type View = 'new' | 'coming'

const text = {
  name: 'Althar',
  upToDate: 'Up to date',
  ready: (version: string) => `${version} is ready`,
  views: 'View',
  whatsNew: 'What’s new',
  comingNext: 'Coming next',
  /** The lead's pictures, by the site's name for each, under a title of their own. */
  pictures: { home: 'Where the work runs now' } as Readonly<Record<string, string>>,
} as const

/** The releases listed at the page's foot; the site has the rest. */
const LISTED = 6

/** What the app draws for a release's lead, by the site's name for its picture. */
const leadPicture = (picture: string | undefined) => {
  const title = picture === undefined ? undefined : text.pictures[picture]
  if (picture !== 'home' || title === undefined) return undefined
  return { title, drawing: <YourWorkers /> }
}

export function AltharPage({ view, onView, onWay }: { view: View; onView: (view: View) => void; onWay: (to: Way) => void }) {
  const news = useNews()
  const update = useUpdate()
  const { look } = news
  useEffect(() => look(), [look])
  const { release } = news
  const ready = update.ready?.version
  return (
    <div className={s.page}>
      <TitleBar
        lights="none"
        className={s.bar}
        end={
          <TaskHeader<View>
            title={text.name}
            status={TaskStatus.Done}
            state={ready === undefined ? text.upToDate : text.ready(ready)}
            faces={[
              { value: 'new', label: text.whatsNew },
              { value: 'coming', label: text.comingNext },
            ]}
            face={view}
            onFace={onView}
            text={{ faces: text.views }}
          />
        }
      >
        <Heading level={1} className={s.crumb}>
          <span className={s.crumbName}>
            <Logo size={18} />
            {text.name}
          </span>
        </Heading>
      </TitleBar>
      {/* Each view opens at its top, with a scroll of its own. */}
      <div key={view} className={s.view}>
        {view === 'coming' ? (
          <ComingNext items={roadmapOf()} suggest={ISSUES} talk={COMMUNITY} />
        ) : (
          release !== undefined && <News release={release} from={news.from} onComing={() => onView('coming')} onWay={onWay} />
        )}
      </div>
    </div>
  )
}

function News({
  release,
  from,
  onComing,
  onWay,
}: {
  release: (typeof RELEASES)[number]
  from: string | undefined
  onComing: () => void
  onWay: (to: Way) => void
}) {
  const lead = leadOf(release)
  const picture = leadPicture(lead.picture)
  const features: readonly WhatsNewFeature[] = featuresOf(release, lead.covers).map(({ way, ...feature }) => ({
    ...feature,
    ...(way === undefined ? {} : { way: { label: way.label, onPress: () => onWay(way.to) } }),
  }))
  const at = RELEASES.indexOf(release)
  const listed = RELEASES.slice(Math.max(0, at), Math.max(0, at) + LISTED)
  const rest = RELEASES[Math.max(0, at) + LISTED]
  return (
    <WhatsNew
      release={release}
      {...(from === undefined ? {} : { from })}
      lead={{ title: lead.title, why: lead.why, ...(picture === undefined ? {} : { picture }) }}
      features={features}
      also={features.length > 0 ? [] : alsoOf(release, lead.covers)}
      better={betterOf(release)}
      follow={FOLLOW}
      releases={listed}
      {...(rest === undefined ? {} : { more: { href: CHANGELOG, from: rest.version } })}
      onComing={onComing}
    />
  )
}
