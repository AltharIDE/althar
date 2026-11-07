import { createRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { CommentChip, Room } from '@althar/ui'

import { useServices } from '../../data/services'
import { rootRoute } from '../../root'
import { composerComment, drop, useComments } from '../../shared/comments'
import { type Origin, pages, usePage } from './pages'
import { PageView } from './PageView'
import s from './PageTab.module.css'

/*
 * A page in a tab of its own, after the projects' (ADR-100): docked there
 * from beside its conversation, with its history and its session, and back
 * beside it when the person says. Its comments still go to the
 * conversation it came from: they wait in that conversation's composer, and
 * show at the tab's foot, each opening again on the page. Once the page is
 * no longer in its tab, closed or back beside, the window goes back there.
 * A window reloaded on the tab waits for main's word that the page is still
 * there before it shows it, or goes back.
 */

export const text = {
  comments: 'Comments for the conversation',
} as const

/** Back beside the conversation the page came from: its task, or its project's conversation. */
const toOrigin = (navigate: ReturnType<typeof useNavigate>, origin: Origin) =>
  origin.kind === 'task'
    ? navigate({ to: '/threads/$threadId', params: { threadId: origin.threadId } })
    : navigate({ to: '/projects/$projectId', params: { projectId: origin.projectId }, search: { room: Room.Talk } })

function PageTab() {
  const { owner } = pageRoute.useParams()
  const navigate = useNavigate()
  const { where } = usePage(owner, useServices().host.pages)
  const origin = pages.originOf(owner)
  const comments = useComments(origin?.draft ?? '')
  const away = where !== 'tab' && !pages.waking(owner)
  useEffect(() => {
    if (away && origin !== null) void toOrigin(navigate, origin)
  }, [away, origin, navigate])
  if (origin === null || where !== 'tab') return null
  return (
    <div className={s.tab}>
      <div className={s.page}>
        <PageView owner={owner} kind={origin.kind} draft={origin.draft} where="tab" onDock={() => pages.place(owner, 'beside')} />
      </div>
      {comments.length > 0 && (
        <ul className={s.comments} aria-label={text.comments}>
          {comments.map((comment, index) => (
            <li key={comment.id}>
              <CommentChip
                comment={composerComment(comment, index + 1)}
                onOpen={() => pages.reopen(owner, comment.id)}
                onRemove={() => drop(origin.draft, comment.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A page in a tab of its own, by its owner: /pages/task_…. One the window doesn't know, nor kept where it came from, goes to the home. */
export const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pages/$owner',
  component: PageTab,
  beforeLoad: ({ params: { owner } }) => {
    if (pages.originOf(owner) === null) throw redirect({ to: '/' })
  },
})
