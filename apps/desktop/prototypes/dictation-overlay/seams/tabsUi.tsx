// Throwaway: the kit as the window's tabs see it. In D, the project's tab carries the dictation, beside its name.
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { ProjectTabs as KitProjectTabs, type ProjectTabsProps } from '@althar/ui'

import { D } from '../ideas/D'
import { useView } from '../ideas/common'

export * from '@althar/ui'

/** The tab of the project it goes to: a place in it, after its name, for D to draw in. */
const useTabPlace = (wrap: HTMLElement | null, name: string, on: boolean) => {
  const [place, setPlace] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (wrap === null || !on) return
    const find = () => {
      const tab = [...wrap.querySelectorAll('li')].find((li) => li.querySelector('button')?.textContent?.startsWith(name) === true)
      if (tab === undefined) return
      let here = tab.querySelector<HTMLElement>('[data-dictation]')
      if (here === null) {
        here = document.createElement('span')
        here.dataset.dictation = ''
        here.style.display = 'contents'
        tab.insertBefore(here, tab.lastElementChild)
        // Room for it beside the name: the tab grows, and the × keeps its place at the end.
        tab.style.maxWidth = 'none'
        tab.style.paddingRight = '22px'
        const select = tab.querySelector<HTMLElement>('button')
        if (select !== null) select.style.paddingRight = '8px'
      }
      setPlace((was) => (was === here ? was : here))
    }
    find()
    const id = window.setInterval(find, 500)
    return () => {
      window.clearInterval(id)
      // Another idea: the tab as it was.
      for (const here of wrap.querySelectorAll<HTMLElement>('[data-dictation]')) {
        const tab = here.parentElement
        here.remove()
        if (tab === null) continue
        tab.style.maxWidth = ''
        tab.style.paddingRight = ''
        const select = tab.querySelector<HTMLElement>('button')
        if (select !== null) select.style.paddingRight = ''
      }
    }
  }, [wrap, name, on])
  return place
}

export function ProjectTabs(props: ProjectTabsProps) {
  const view = useView()
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  const on = view.live.idea === 'D' && view.shown
  const place = useTabPlace(wrap, view.to.where, on)
  return (
    <div ref={setWrap} style={{ display: 'contents' }}>
      <KitProjectTabs {...props} />
      {on && place !== null && createPortal(<D view={view} />, place)}
    </div>
  )
}
