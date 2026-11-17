import type { ThreadSnapshot } from '@althar/contracts'
import { ShipButton } from '@althar/ui'

import { useModelNames } from '../../shared/modelNames'
import { commitsToShip } from '../../shared/shipping'
import { kitRoute, kitStop, routeOf } from '../../shared/shipRoute'
import { useShipRoute } from '../settings/useShipRoute'
import type { TaskModel } from './useTask'

/*
 * Ship on the task's Change card: its route on the button, from the one the person chose for this Ship, else the task's own;
 * under way, the same button greyed at the stop it is at, from the press on (a task is a conversation plus parts).
 */

export const text = {
  commits: (n: number) => (n === 1 ? '1 commit' : `${n} commits`),
  newPullRequest: 'a new pull request',
  reviewing: 'Reviewing',
  settling: 'Fixing what the review found',
  pushing: (commits: string) => `Pushing ${commits}`,
  markingReady: 'Marking ready',
  merging: 'Merges once checks pass',
  bent: 'Main here needs an approval from someone else, so it stops at Ready for review.',
}

/** A task's own route where the runtime doesn't say it: its plan's review, if it has one, and as far as its ending goes. */
const ownOf = ({ task }: ThreadSnapshot) => {
  const reviewable = task.steps.some((step) => step.key === 'review' && !step.skipped)
  return { route: { review: reviewable, far: task.end === 'ready' ? ('ready' as const) : ('push' as const) }, reviewable, bent: null }
}

/** What of the task's model Ship uses. */
export type ShipModel = Pick<
  TaskModel,
  'ship' | 'shipChoice' | 'chooseShipRoute' | 'shipPressed' | 'routeShip' | 'shipRerouted' | 'skipReview'
>

export function ShipControl({ snapshot, model, disabled = false }: { snapshot: ThreadSnapshot; model: ShipModel; disabled?: boolean }) {
  const { task } = snapshot
  const named = useModelNames()
  const mine = useShipRoute()
  // From a runtime before routes: its plan's review, and as far as its ending goes.
  const own = task.shipRoute ?? ownOf(snapshot)
  const open = task.changes.find((one) => one.state === 'open')
  const n = task.held?.commits ?? commitsToShip(task)
  const reviewStep = task.steps.find((step) => step.key === 'review')
  const about = {
    commits: text.commits(n),
    to: open === undefined ? text.newPullRequest : `${open.short} ${open.prefix}${open.number}`,
    reviewer: reviewStep === undefined ? null : named(reviewStep.agentId, reviewStep.model).name,
    theirs: own?.bent === 'approval',
  }
  const readyAlready = open !== undefined && !open.draft
  // Under way as the runtime says it, else as pressed here, until a read has it.
  const under = task.shipping ?? model.shipPressed
  if (under != null) {
    const route = model.shipRerouted ?? under.route
    const label = (() => {
      switch (under.at) {
        case 'review':
          return task.step === 'settle' ? text.settling : text.reviewing
        case 'push':
          return text.pushing(about.commits)
        case 'ready':
          return text.markingReady
        case 'merge':
          return text.merging
      }
    })()
    return (
      <ShipButton
        route={kitRoute(route)}
        onRoute={(next) => void model.routeShip(routeOf(next))}
        about={about}
        readyAlready={readyAlready}
        underWay={{ label, at: kitStop(under.at) }}
        {...(task.skipReview === true ? { onSkipReview: () => void model.skipReview() } : {})}
      />
    )
  }
  const route = model.shipChoice ?? own.route
  const fallback = mine?.route ?? own.route
  return (
    <ShipButton
      route={kitRoute(route)}
      onRoute={(next) => model.chooseShipRoute(routeOf(next))}
      about={about}
      reviewable={own.reviewable}
      readyAlready={readyAlready}
      defaultRoute={kitRoute(fallback)}
      {...(model.shipChoice === null || mine === null ? {} : { onMakeDefault: () => mine.set(route) })}
      {...(own.bent === 'approval' && model.shipChoice === null ? { note: text.bent } : {})}
      onShip={() => void model.ship()}
      disabled={disabled}
    />
  )
}
