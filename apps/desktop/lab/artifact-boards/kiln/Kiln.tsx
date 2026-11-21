import { useEffect, useState } from 'react'

import s from './kiln.module.css'

const cx = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

/*
 * Kiln, the product the made-up team builds: a pottery studio's class
 * bookings, on the web, in its own look rather than Althar's. Each screen is
 * drawn from the address (kiln.html?s=…), as a task's running copy would
 * serve it: Your bookings in its states, the classes, a class, checkout,
 * and Gift a class, the page Maya designs, in its versions (v). A part's
 * look can change while it shows, as a dev server's hot reload would: the
 * canvas posts it (`kiln:look`), and `look=card:warm` starts with it.
 * `built=1` is Ana's build of the design, near it but not quite.
 */

/** How a part of the page looks, where it differs from its version's own: amounts, card. */
export type Look = Readonly<Record<string, string>>

const lookOf = (params: URLSearchParams): Look =>
  Object.fromEntries(
    (params.get('look') ?? '')
      .split(',')
      .filter((one) => one.includes(':'))
      .map((one) => one.split(':') as [string, string]),
  )

export type Screen = 'bookings' | 'classes' | 'class' | 'checkout' | 'gift'

const CLASSES = [
  { name: 'Wheel throwing for beginners', when: 'Tue 18:30 · 2 hours', price: '£35', left: '2 places left', ink: 'clay' },
  { name: 'Hand-building: pinch and coil', when: 'Thu 10:00 · 3 hours', price: '£45', left: '5 places left', ink: 'sand' },
  { name: 'Glazing your first pieces', when: 'Sat 14:00 · 2 hours', price: '£40', left: 'Full · waitlist', ink: 'green' },
  { name: 'A weekend of hand-building', when: 'Sat and Sun · 10:00', price: '£90', left: '4 places left', ink: 'ochre' },
  { name: 'Open studio, a month', when: 'Any day · 9:00 to 21:00', price: '£140', left: 'Always open', ink: 'clay' },
  { name: 'Throwing bigger: bowls', when: 'Wed 19:00 · 2 hours', price: '£38', left: '3 places left', ink: 'sand' },
] as const

const Top = ({ here = 'Your bookings' }: { here?: string }) => (
  <header className={s.top}>
    <span className={s.logo}>Kiln</span>
    <nav className={s.nav}>
      <span className={cx(here === 'Classes' && s.on)}>Classes</span>
      <span>Open studio</span>
      <span className={cx(here === 'Gift a class' && s.on)}>Gift a class</span>
    </nav>
    <span className={s.gap} />
    <span className={cx(s.here, here === 'Your bookings' && s.on)}>Your bookings</span>
    <span className={s.me} aria-hidden>
      J
    </span>
  </header>
)

/** A photograph's place: a pot, drawn, on the class's colour. */
const Pot = ({ ink, tall = false }: { ink: string; tall?: boolean }) => (
  <span className={cx(s.photo, tall && s.tall)} data-ink={ink} aria-hidden>
    <span className={s.potShape} />
  </span>
)

/* ——— Your bookings ——— */

function Bookings({ state }: { state: string }) {
  const booked = state === 'booked' ? CLASSES.slice(0, 2) : state === 'full' ? CLASSES.slice(0, 5) : []
  return (
    <>
      <Top />
      <main className={s.page}>
        <section className={s.main}>
          <h1 className={s.h1}>Your bookings</h1>
          <div className={s.tabs} role="tablist">
            <span role="tab" aria-selected>
              Upcoming
            </span>
            <span role="tab">Past</span>
          </div>
          {booked.length === 0 ? (
            <div className={s.empty}>
              <span className={s.pot} aria-hidden />
              <h2 className={s.emptyTitle}>Nothing booked yet</h2>
              <p className={s.emptyLine}>Pick a class that fits your week. Every class starts from the beginning, so come as you are.</p>
              <button type="button" className={s.go}>
                Find a class
              </button>
            </div>
          ) : (
            <ul className={s.bookings}>
              {booked.map((one) => (
                <li key={one.name}>
                  <Pot ink={one.ink} />
                  <span className={s.bookingWhat}>
                    <strong>{one.name}</strong>
                    <span>{one.when}</span>
                  </span>
                  <span className={s.bookingWays}>
                    <span>Move</span>
                    <span>Cancel</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className={s.side}>
          <h2 className={s.sideTitle}>This week at the studio</h2>
          <ul className={s.week}>
            {CLASSES.slice(0, 3).map((one) => (
              <li key={one.name}>
                <span className={s.weekWhat}>{one.name}</span>
                <span className={s.weekWhen}>
                  {one.when.split(' · ')[0]} · {one.left}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </>
  )
}

/* ——— The classes ——— */

function Classes() {
  return (
    <>
      <Top here="Classes" />
      <main className={s.wide}>
        <h1 className={s.h1}>Classes</h1>
        <p className={s.lede}>Small groups, everything provided. Every class starts from the beginning.</p>
        <ul className={s.grid}>
          {CLASSES.map((one) => (
            <li key={one.name} className={s.classCard}>
              <Pot ink={one.ink} />
              <strong>{one.name}</strong>
              <span>
                {one.when} · {one.price}
              </span>
              <span className={s.left}>{one.left}</span>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}

function OneClass() {
  const one = CLASSES[0]
  return (
    <>
      <Top here="Classes" />
      <main className={s.classPage}>
        <Pot ink={one.ink} tall />
        <section>
          <h1 className={s.h1}>{one.name}</h1>
          <p className={s.lede}>
            Two hours at the wheel with Rosa. You’ll centre the clay, open it and pull up your first walls, and leave with two pots to be
            fired.
          </p>
          <ul className={s.dates}>
            {['Tue 18 Nov · 18:30', 'Tue 25 Nov · 18:30', 'Tue 2 Dec · 18:30'].map((date, i) => (
              <li key={date} data-on={i === 0 || undefined}>
                <span>{date}</span>
                <span>{i === 0 ? '2 places left' : '6 places left'}</span>
              </li>
            ))}
          </ul>
          <button type="button" className={s.go}>
            Book · {one.price}
          </button>
        </section>
      </main>
    </>
  )
}

function Checkout({ door }: { door: boolean }) {
  return (
    <>
      <Top />
      <main className={s.checkout}>
        <section>
          <h1 className={s.h1}>Book your place</h1>
          <div className={s.summary}>
            <Pot ink="clay" />
            <span className={s.bookingWhat}>
              <strong>Wheel throwing for beginners</strong>
              <span>Tue 18 Nov · 18:30 · £35</span>
            </span>
          </div>
          <h2 className={s.h2}>How you’ll pay</h2>
          <div className={s.choices}>
            <span className={s.choice} aria-selected>
              Card now
            </span>
            {door && <span className={s.choice}>At the door</span>}
          </div>
          <div className={s.fieldRow}>
            <span className={s.fieldBox}>Card number</span>
            <span className={s.fieldBox}>MM / YY</span>
          </div>
          <button type="button" className={s.go}>
            Pay £35
          </button>
        </section>
      </main>
    </>
  )
}

/* ——— Gift a class: the page Maya designs ——— */

export type GiftDirection = 'a' | 'b' | 'c' | 'ab'

const AMOUNTS = {
  plain: [
    { name: '£30', line: '', buys: '', ink: 'clay' },
    { name: '£60', line: '', buys: '', ink: 'clay' },
    { name: '£120', line: '', buys: '', ink: 'clay' },
  ],
  named: [
    { name: 'An evening on the wheel', line: '£35', buys: 'Two hours, two pots to keep', ink: 'clay' },
    { name: 'A weekend of hand-building', line: '£90', buys: 'Two days, as many pots as fit', ink: 'sand' },
    { name: 'A month of open studio', line: '£140', buys: 'Any day, with a shelf of their own', ink: 'ochre' },
  ],
}

const CARD_LOOKS: Readonly<Record<string, string | undefined>> = { quiet: s.cardQuiet, warm: s.cardWarm, bold: s.cardBold }

/** The card itself: what arrives in the friend's inbox. */
const GiftCard = ({ v, look = 'usual' }: { v: number; look?: string }) => (
  <div className={cx(s.card, CARD_LOOKS[look])} data-part="card">
    <span className={s.cardKiln}>Kiln</span>
    <span className={s.cardPot} aria-hidden />
    <span className={s.cardFor}>For Jo</span>
    <span className={s.cardWhat}>{v >= 3 ? 'An evening on the wheel' : 'A class at Kiln'}</span>
    <span className={s.cardNote}>“You’ve talked about this for years. Go and get muddy.” Sam</span>
  </div>
)

const Fields = ({ go, v }: { go: string; v: number }) => (
  <div className={s.fields}>
    <div className={s.field}>
      <span>Their name</span>
      <span className={s.fieldBox}>Jo</span>
    </div>
    <div className={s.field}>
      <span>Their email</span>
      <span className={s.fieldBox}>jo@example.com</span>
    </div>
    <div className={cx(s.field, s.full)} data-part="note">
      <span>A note from you</span>
      <span className={cx(s.fieldBox, s.tallBox)}>You’ve talked about this for years. Go and get muddy.</span>
    </div>
    {v >= 3 && (
      <div className={s.field}>
        <span>Send it on</span>
        <span className={s.fieldBox}>Fri 12 Dec</span>
      </div>
    )}
    <button type="button" className={s.go} data-part="go">
      {go}
    </button>
  </div>
)

function GiftA({ v, look, built }: { v: number; look: Look; built: boolean }) {
  const amounts = v >= 3 ? AMOUNTS.named : AMOUNTS.plain
  // v4 made the amounts presents (A, 2); v5 the card warmer (A, 3).
  const presents = (look.amounts ?? (v >= 4 ? 'presents' : 'named')) === 'presents'
  const card = look.card ?? (v >= 5 ? 'warm' : 'usual')
  if (v === 1)
    return (
      <main className={s.narrow}>
        <h1 className={s.h1}>Gift cards</h1>
        <h2 className={s.h2}>Amount</h2>
        <div className={s.choices}>
          {amounts.map((one, i) => (
            <span key={one.name} className={s.choice} aria-selected={i === 1}>
              {one.name}
            </span>
          ))}
        </div>
        <h2 className={s.h2}>Recipient</h2>
        <Fields go="Buy gift card" v={v} />
      </main>
    )
  return (
    <main className={cx(s.gift, built && s.built)}>
      <section className={s.giftSide}>
        <GiftCard v={v} look={card} />
      </section>
      <section className={s.giftForm}>
        <h1 className={s.h1} data-part="title">
          Give someone a class
        </h1>
        <p className={s.lede}>They choose the day. You choose what to give.</p>
        <div className={cx(s.choices, v >= 3 && s.choicesNamed, presents && s.choicesPresents)} data-part="amounts">
          {amounts.map((one, i) => (
            <span key={one.name} className={s.choice} aria-selected={i === 0}>
              {presents && <span className={s.choicePot} data-ink={one.ink} aria-hidden />}
              <span className={s.choiceName}>{one.name}</span>
              {presents && <span className={s.choiceBuys}>{one.buys}</span>}
              {one.line !== '' && <span className={s.choiceLine}>{one.line}</span>}
            </span>
          ))}
        </div>
        <Fields go="Send the gift" v={v} />
      </section>
    </main>
  )
}

function GiftB({ withCard }: { withCard: boolean }) {
  return (
    <main className={s.wide}>
      {withCard ? (
        <div className={s.giftHero}>
          <GiftCard v={3} />
          <div>
            <h1 className={s.h1}>Give someone a class</h1>
            <p className={s.lede}>Pick the class. They pick the day, any time in the next year.</p>
          </div>
        </div>
      ) : (
        <>
          <h1 className={s.h1}>Give a class</h1>
          <p className={s.lede}>Pick the class. They pick the day, any time in the next year.</p>
        </>
      )}
      <ul className={cx(s.grid, withCard && s.compact)}>
        {CLASSES.slice(0, withCard ? 3 : 6).map((one, i) => (
          <li key={one.name} className={cx(s.classCard, i === 0 && s.picked)}>
            <Pot ink={one.ink} />
            <strong>{one.name}</strong>
            <span>{one.price}</span>
          </li>
        ))}
      </ul>
      <div className={s.giftBar}>
        <span className={s.fieldBox}>Their name</span>
        <span className={s.fieldBox}>Their email</span>
        <button type="button" className={s.go}>
          Give this class · £35
        </button>
      </div>
    </main>
  )
}

function GiftC() {
  return (
    <main className={s.letter}>
      <p className={s.kicker}>Gift a class</p>
      <h1 className={s.letterDear}>
        Dear <span className={s.blank}>Jo</span>,
      </h1>
      <p className={s.letterLine}>
        I’d like to give you <span className={s.blank}>an evening on the wheel</span> at Kiln, on a day that suits you.
      </p>
      <p className={s.letterLine}>
        <span className={s.blank}>You’ve talked about this for years. Go and get muddy.</span>
      </p>
      <p className={s.letterSign}>
        Love, <span className={s.blank}>Sam</span>
      </p>
      <div className={s.letterFoot}>
        <span className={s.fieldBox}>jo@example.com</span>
        <button type="button" className={s.go}>
          Wrap it up · £35
        </button>
      </div>
    </main>
  )
}

function Gift({ dir, v, look, built }: { dir: GiftDirection; v: number; look: Look; built: boolean }) {
  return (
    <>
      <Top here="Gift a class" />
      {dir === 'a' ? (
        <GiftA v={v} look={look} built={built} />
      ) : dir === 'b' ? (
        <GiftB withCard={false} />
      ) : dir === 'ab' ? (
        <GiftB withCard />
      ) : (
        <GiftC />
      )}
    </>
  )
}

export function Kiln({ params }: { params: URLSearchParams }) {
  const screen = (params.get('s') ?? 'bookings') as Screen
  // What the canvas posts while the page shows: a part's new look, landing as a hot reload would.
  const [look, setLook] = useState<Look>(() => lookOf(params))
  useEffect(() => {
    const posted = (event: MessageEvent<{ kind?: string; look?: Look }>) => {
      if (event.data.kind === 'kiln:look' && event.data.look !== undefined) setLook({ ...lookOf(params), ...event.data.look })
    }
    window.addEventListener('message', posted)
    return () => window.removeEventListener('message', posted)
  }, [params])
  return (
    <div className={s.kiln}>
      {screen === 'gift' ? (
        <Gift
          dir={(params.get('dir') ?? 'a') as GiftDirection}
          v={Number(params.get('v') ?? '3')}
          look={look}
          built={params.has('built')}
        />
      ) : screen === 'classes' ? (
        <Classes />
      ) : screen === 'class' ? (
        <OneClass />
      ) : screen === 'checkout' ? (
        <Checkout door={params.has('door')} />
      ) : (
        <Bookings state={params.get('state') ?? 'empty'} />
      )}
    </div>
  )
}
