import { Logo } from '../../components/Logo'
import { Wordmark } from '../../components/Wordmark'
import { useMeta } from '../../lib/useMeta'
import { NOT_FOUND } from '../../meta'
import { homeHref, researchHref } from '../../paths'
import s from './NotFound.module.css'

export function NotFound() {
  useMeta(NOT_FOUND)
  return (
    <div className={s.page}>
      <header className={s.mast}>
        <a className={s.brand} href={homeHref}>
          <Logo />
          Althar
        </a>
        <nav className={s.pages} aria-label="Pages">
          <a href={homeHref}>Brief</a>
          <a href={researchHref}>Research note</a>
        </nav>
      </header>
      <main className={s.main} id="main" tabIndex={-1}>
        <p className={s.kicker}>404</p>
        <h1>Nothing here.</h1>
        <p className={s.lead}>This page isn’t part of the brief. The project persists; this link didn’t.</p>
        <a className={s.home} href={homeHref}>
          Back to the brief
        </a>
      </main>
      <Wordmark />
    </div>
  )
}
