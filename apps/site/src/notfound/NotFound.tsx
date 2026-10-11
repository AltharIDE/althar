import { Footer } from '../shared/footer/Footer'
import { Lit } from '../shared/Lit'
import { Nav } from '../shared/Nav'
import { Ways } from '../shared/Ways'
import s from './NotFound.module.css'

/* Any address that isn't a page: built as 404.html, which Cloudflare serves for it with a 404. */

export function NotFound() {
  return (
    <div className={s.page}>
      <Nav />
      <main id="main" tabIndex={-1}>
        <Lit
          kicker="404"
          title={
            <>
              There’s no page <b>at this address.</b>
            </>
          }
          lead="It may have moved, or the link may be wrong. From here:"
        />
        <Ways
          ways={[
            { href: '/', name: 'Althar', note: 'What it is, and how it runs your agents' },
            { href: '/shifts', name: 'Shifts', note: 'What changed for people who code with agents' },
            { href: '/thesis', name: 'The thesis', note: 'What Althar is for, and why' },
          ]}
        />
      </main>
      <Footer />
    </div>
  )
}
