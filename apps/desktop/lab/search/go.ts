import { coordinatorOf, threadIdOf } from './data'
import type { Entry, Go } from './index'
import { remember, router, say } from './state'

/*
 * Doing what was chosen, on the real app: going to a task, a project's view
 * or a setting through its router; pressing the app's own key for what has
 * one (⌘, ⌘U ⌘N); writing to the coordinator in its composer. A passage
 * found inside a thread opens there: the thread scrolls to the message and
 * it is tinted a moment, so the eye lands on it. What would act on work
 * (push, merge, stop) says what it would have done in a line instead.
 */

const isMac = /Mac/.test(navigator.platform)

const press = (key: string, shift = false) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: key === ',' ? 'Comma' : `Key${key.toUpperCase()}`,
      metaKey: isMac,
      ctrlKey: !isMac,
      shiftKey: shift,
      bubbles: true,
    }),
  )

const squash = (text: string) => text.replace(/\s+/g, ' ').replace(/[*_`]/g, '').trim()

/** Waits for what was said to be drawn, then brings it into view and tints it a moment. */
const reveal = (said: string) => {
  const wanted = squash(said).slice(0, 48)
  const began = performance.now()
  const look = () => {
    const blocks = document.querySelectorAll<HTMLElement>('[data-thread-preview], [data-rhythm] p, li, p')
    const found = Array.from(blocks).find((one) => one.offsetParent !== null && squash(one.textContent ?? '').includes(wanted))
    if (found === undefined) {
      if (performance.now() - began < 4000) requestAnimationFrame(look)
      return
    }
    const block = found.closest<HTMLElement>('[data-rhythm]') ?? found
    // A thread opens at its latest message, a moment after it is drawn: once it has, here instead.
    block.scrollIntoView({ block: 'center' })
    for (const after of [120, 320, 640]) setTimeout(() => block.scrollIntoView({ block: 'center' }), after)
    block.animate(
      [
        { backgroundColor: 'var(--signal-paper)' },
        { backgroundColor: 'var(--signal-paper)', offset: 0.6 },
        { backgroundColor: 'transparent' },
      ],
      {
        duration: 2200,
        easing: 'ease-out',
      },
    )
  }
  requestAnimationFrame(look)
}

/** Writes `text` in the composer once it's drawn, and puts the caret after it. */
const compose = (text: string) => {
  const began = performance.now()
  const look = () => {
    const field = document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"], textarea')
    if (field === null) {
      if (performance.now() - began < 3000) requestAnimationFrame(look)
      return
    }
    field.focus()
    if (text !== '') document.execCommand('insertText', false, text)
  }
  requestAnimationFrame(look)
}

/** Does what `go` says; `entry` is counted as opened, for the habit. */
export const run = (go: Go, entry?: Entry) => {
  const app = router.current
  if (entry !== undefined) remember(entry.id)
  if (app === null) return
  switch (go.to) {
    case 'home':
      void app.navigate({ to: '/' })
      return
    case 'task':
      void app.navigate({ to: '/threads/$threadId', params: { threadId: threadIdOf(go.slug) } }).then(() => {
        if (go.face === 'out') requestAnimationFrame(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true })))
        if (go.at !== undefined) reveal(go.at)
      })
      return
    case 'project':
      void app
        .navigate({
          to: '/projects/$projectId',
          params: { projectId: go.project },
          search: {
            ...(go.room === undefined ? {} : { room: go.room as never }),
            ...(go.section === undefined ? {} : { section: go.section as never }),
          },
        })
        .then(() => {
          if (go.at !== undefined) reveal(go.at)
        })
      return
    case 'settings':
      void app.navigate({ to: '/settings/$section', params: { section: go.section } })
      return
    case 'key':
      // After the box has closed, so the key reaches the app as if pressed on its screen.
      requestAnimationFrame(() => press(go.key, go.shift))
      return
    case 'ask':
      void app
        .navigate({ to: '/projects/$projectId', params: { projectId: go.project }, search: { room: 'talk' as never } })
        .then(() => compose(go.text))
      return
    case 'say':
      say(go.line)
      return
  }
}

export { coordinatorOf }
