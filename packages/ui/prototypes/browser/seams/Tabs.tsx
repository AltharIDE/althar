// Scrappy: the window's tabs. In A, pages open in Althar's browser have tabs of their own after the projects', and the page with the
// window covers the screen under the bar, as a project's screen does; in B, C and D the bar is the app's as built.
import { useLayoutEffect, useState } from 'react'

import { ProjectTabs as Built, type ProjectTabsProps } from '../../../src/chrome/ProjectTabs/ProjectTabs'
import { shown } from '../addresses'
import { PageScreen } from '../parts/PageScreen'
import { addressOf, type Page, proto, useProto } from '../state'
import { PagedTabs } from './PagedTabs'

/** A page's tab: a run by its host, anything else by its title once it has one. */
const nameOf = (page: Page) => {
  const address = addressOf(page)
  if (address === '') return 'New page'
  if (address.startsWith('http://localhost')) return shown(address).split('/')[0] ?? address
  return page.title?.split(' · ')[0] ?? shown(address)
}

export function ProjectTabs(props: ProjectTabsProps) {
  const p = useProto()
  const [top, setTop] = useState(44)
  useLayoutEffect(() => {
    const bar = document.querySelector('nav[aria-label="Projects"]')?.closest('header')
    if (bar != null) setTop(bar.getBoundingClientRect().bottom)
  }, [p.page, p.direction])
  // In E, a page has a tab only where the person took it out of the conversation's side.
  if (p.direction !== 'A' && !(p.direction === 'E' && p.pages.length > 0)) return <Built {...props} />
  const leave = () => proto.showPage(null)
  return (
    <>
      <PagedTabs
        {...props}
        onSelect={(id) => {
          leave()
          props.onSelect(id)
        }}
        {...(props.settings === undefined
          ? {}
          : {
              settings: {
                ...props.settings,
                current: props.settings.current && p.page === null,
                onSelect: () => {
                  leave()
                  props.settings?.onSelect()
                },
              },
            })}
        pages={p.pages.map((one) => ({ id: one.id, name: nameOf(one), title: addressOf(one) }))}
        page={p.page}
        onPage={proto.showPage}
        onClosePage={proto.closePage}
        onNewPage={proto.newPage}
      />
      {p.page !== null && <PageScreen top={top} />}
    </>
  )
}
