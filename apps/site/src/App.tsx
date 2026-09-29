import { Home } from './home/Home'
import { Thesis } from './thesis/Thesis'

/** The landing page at the root, and the thesis at /thesis. Any other path is the landing page. */
export function App({ pathname }: { pathname: string }) {
  const thesis = pathname.replace(/\/+$/, '') === '/thesis'
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {thesis ? <Thesis /> : <Home />}
    </>
  )
}
