import { LINKS } from '../content/facts'
import { Footer } from '../shared/footer/Footer'
import { Lit } from '../shared/Lit'
import { Nav } from '../shared/Nav'
import s from './Docs.module.css'

/*
 * The docs' place, until they are published: the head in the site's light,
 * and where to read in the meantime.
 */

export function Docs() {
  return (
    <div className={s.page}>
      <Nav />
      <main id="main" tabIndex={-1}>
        <Lit
          kicker="Docs"
          title={
            <>
              The docs are <b>being written.</b>
            </>
          }
          lead="How to install Althar, sign in your agents and run a project, step by step. Until they’re here:"
        />
        <ul className={s.ways}>
          <li>
            <a href={LINKS.repo}>
              <b>The README</b>
              <span>Installing, and signing in your agents</span>
            </a>
          </li>
          <li>
            <a href="/thesis">
              <b>The thesis</b>
              <span>What Althar is for, and why</span>
            </a>
          </li>
          <li>
            <a href={LINKS.issues}>
              <b>Issues</b>
              <span>Ask, or tell us what’s missing</span>
            </a>
          </li>
        </ul>
      </main>
      <Footer />
    </div>
  )
}
