import { WALLPAPER, wallpaperFile, wallpaperPreview } from '../content/wallpaper'
import { cx } from '../lib/cx'
import { Bar } from '../shared/Bar'
import { Close } from '../shared/Close'
import s from './Wallpaper.module.css'

/*
 * The wallpaper, to take away. A plain head, then Aurora in light and in
 * dark, each as large as the page allows with the phone's beside it, and its
 * files under it. Dark sits on ink, as it would on a dark desktop.
 */

export function Wallpaper() {
  return (
    <div className={s.page}>
      <Bar tone="paper" base="/" />
      <main id="main" tabIndex={-1}>
        <header className={s.head}>
          <div className={s.wrap}>
            <h1 className={s.h1}>
              <span className={s.dim}>{WALLPAPER.title[0]}</span>
              <span>{WALLPAPER.title[1]}</span>
            </h1>
            <p className={s.lead}>{WALLPAPER.lead}</p>
          </div>
        </header>

        {WALLPAPER.themes.map((t) => (
          <section key={t.key} id={t.key} className={cx(s.theme, t.key === 'dark' && s.ink)} aria-labelledby={`${t.key}-h`}>
            <div className={s.wrap}>
              <div className={s.pair}>
                <img
                  className={s.picture}
                  src={wallpaperPreview(t.key, 'mac')}
                  srcSet={`${wallpaperPreview(t.key, 'mac')} 1600w, ${wallpaperFile(t.key, 'mac')} 3456w`}
                  sizes="(max-width: 1280px) 75vw, 920px"
                  width={1600}
                  height={1034}
                  alt={t.alt}
                  loading={t.key === 'light' ? 'eager' : 'lazy'}
                  decoding="async"
                />
                <img
                  className={s.picture}
                  src={wallpaperPreview(t.key, 'phone')}
                  width={600}
                  height={1300}
                  alt=""
                  loading={t.key === 'light' ? 'eager' : 'lazy'}
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
                        <b>{sc.name}</b>
                        <span>{sc.size}</span>
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
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              {t.key === 'dark' && <p className={s.note}>{WALLPAPER.note}</p>}
            </div>
          </section>
        ))}
      </main>
      <Close />
    </div>
  )
}
