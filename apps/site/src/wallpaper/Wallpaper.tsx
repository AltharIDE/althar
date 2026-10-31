import { WALLPAPER, wallpaperFile, wallpaperPreview } from '../content/wallpaper'
import { cx } from '../lib/cx'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import { Night, night as n, Readout, Window } from '../shared/night/Night'
import s from './Wallpaper.module.css'

/*
 * The wallpaper, to take away. It opens on the night window the changelog
 * does: the wallpaper's name, its themes and its largest size along the
 * top, the words in the middle, and Aurora in dark on a laptop's screen and
 * a phone's, standing on the planet's lit edge. Then each theme on a panel
 * of its own ground, light on paper and dark on ink, as each sits on a
 * desktop, the Mac's and the phone's side by side, and its files to
 * download under them.
 */

const DOWN = (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <path
      d="M8 2.5v8m0 0L4.5 7M8 10.5 11.5 7M3 13.5h10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const LARGEST = WALLPAPER.screens.find((sc) => sc.key === 'display')

export function Wallpaper() {
  return (
    <div className={s.page}>
      <Nav />
      <Night>
        <Window
          deck={
            <>
              <Readout label="Wallpaper" href="#light">
                <b>Aurora</b>
              </Readout>
              <Readout label="Themes" href="#light" at="mid">
                <b>Light · Dark</b>
              </Readout>
              {LARGEST && (
                <Readout label="Up to" href="#dark" at="end">
                  <b>{LARGEST.size}</b>
                </Readout>
              )}
            </>
          }
        >
          <div className={n.head}>
            <h1 className={n.headline}>
              {WALLPAPER.title[0]}. <span className={s.dim}>{WALLPAPER.title[1]}.</span>
            </h1>
            <p className={n.why}>{WALLPAPER.lead}</p>
          </div>
          {/* Aurora in dark, as it sits on a laptop and a phone: a picture of the page's own files, so the readers' eyes, not their screens, say which. */}
          <div className={s.devices} aria-hidden="true">
            <div className={s.laptop}>
              <img src={wallpaperPreview('dark', 'mac')} width={1600} height={1034} alt="" decoding="async" />
            </div>
            <div className={s.phone}>
              <img src={wallpaperPreview('dark', 'phone')} width={600} height={1300} alt="" decoding="async" />
            </div>
          </div>
        </Window>

        <div className={s.themes}>
          {WALLPAPER.themes.map((t) => (
            <section key={t.key} id={t.key} className={cx(s.theme, t.key === 'light' && s.paper)} aria-labelledby={`${t.key}-h`}>
              <div className={s.pair}>
                <img
                  className={s.picture}
                  src={wallpaperPreview(t.key, 'mac')}
                  srcSet={`${wallpaperPreview(t.key, 'mac')} 1600w, ${wallpaperFile(t.key, 'mac')} 3456w`}
                  sizes="(max-width: 1280px) 75vw, 900px"
                  width={1600}
                  height={1034}
                  alt={t.alt}
                  loading="lazy"
                  decoding="async"
                />
                <img
                  className={s.picture}
                  src={wallpaperPreview(t.key, 'phone')}
                  width={600}
                  height={1300}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className={s.files}>
                <h2 id={`${t.key}-h`} className={s.name}>
                  {t.name}
                </h2>
                <ul className={s.links}>
                  {WALLPAPER.screens.map((sc) => (
                    <li key={sc.key}>
                      <a href={wallpaperFile(t.key, sc.key)} download>
                        {DOWN}
                        <b>{sc.name}</b>
                        <span>{sc.size}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
          <p className={s.note}>{WALLPAPER.note}</p>
        </div>
      </Night>
      <Footer />
    </div>
  )
}
