import { LINKS } from '../content/facts'
import { Footer } from '../shared/footer/Footer'
import { Lit } from '../shared/Lit'
import { Nav } from '../shared/Nav'
import { Ways } from '../shared/Ways'
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
        <Ways
          ways={[
            { href: LINKS.repo, name: 'The README', note: 'Installing, and signing in your agents' },
            { href: '/thesis', name: 'The thesis', note: 'What Althar is for, and why' },
            { href: LINKS.issues, name: 'Issues', note: 'Ask, or tell us what’s missing' },
          ]}
        />
      </main>
      <Footer />
    </div>
  )
}
