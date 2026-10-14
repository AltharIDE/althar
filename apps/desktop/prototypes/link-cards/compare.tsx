// Scrappy, and secondary to the live page: every direction's screenshots in order, each opening the live page where it was taken.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import { createRoot } from 'react-dom/client'

import { Heading, LinkButton } from '@althar/ui'

import shots from './shots.json'
import { DIRECTIONS } from './state'

// The screenshots shoot.mjs took, in the task's scratch folder, by their id.
const taken = import.meta.glob<string>('../../../../.althar/scratch/link-cards/shots/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})
const pictureOf = (id: string) => Object.entries(taken).find(([path]) => path.endsWith(`/${id}.png`))?.[1]

const WHAT: Record<string, string> = {
  T: 'ThreadBlocks draws the person’s You, then its links in a row of their own. The thread puts 30px between them, as between any two messages, and the card is as wide as the thread, so it starts after “just now” and spans past the bubble: it reads as an item from nobody. The raw address stays in the words.',
  A: 'The app’s card goes inside the bubble, under the words, and the address in the words becomes the kit’s inline mark and key (“DEV-68”, “#131”). It can only be the person’s. But a white card in a grey bubble is a frame inside a frame, the bubble is always at its widest once it holds one, and the key says what the card under it says again.',
  B: 'The card sits above the bubble, right-aligned at its width, where the kit puts images and files sent with a message. It is clearly attached, but read first, before the words that say why it was sent, and the raw address still runs through the words unless “Show the address as its key” is on.',
  C: 'The card goes in the kit’s own unfurl slot on You, which the app doesn’t use yet: under the bubble, at its width, 6px from it, and the stamp after it. Words, card, time: one message, on the person’s side. C9 and C10 turn on “Show the address as its key”, A’s keys in place of the raw addresses.',
  D: 'Each address becomes a chip in the words: the tracker’s mark, the key and the title, cut to fit. Pointing at it opens the app’s card above it; pressing keeps it open, and the card opens Linear or GitHub. The lightest bubble, but the issue’s status and priority are a hover away, and chips break sentences in the coordinator’s narrow column.',
  E: 'My own: the address becomes the key in the words, and under the bubble, before the stamp, each link gets one quiet line: mark, key, title, where it stands (Todo, Merged), and an arrow that opens it. Clearly part of the message and light for several links, but it drops priority and team, and the Linear card’s colour.',
}

const live = (page: string) => `./${page}`

function Compare() {
  return (
    <div style={{ padding: '32px 40px 80px', display: 'grid', gap: 56, maxWidth: 1440, margin: '0 auto' }}>
      <header style={{ display: 'grid', gap: 8 }}>
        <Heading level={1}>Link cards that belong to their message · the screenshots</Heading>
        <p style={{ margin: 0, maxWidth: 860 }}>
          The live page is the place to compare: the real app on the tests’ fake client, with a switcher under it that swaps the direction
          in place (1–6, ← →), and the message and the thread beside it. These are the shots taken from it; each opens the live page where
          it was taken.
        </p>
        <LinkButton onClick={() => window.location.assign(live('index.html?d=C&s=two&keys'))}>Open the live page</LinkButton>
      </header>
      {DIRECTIONS.map((direction) => {
        const mine = shots.filter((shot) => shot.id.replace(/\d+$/, '') === direction.value)
        return (
          <section key={direction.value} style={{ display: 'grid', gap: 12 }}>
            <Heading level={2}>
              {direction.value === 'T' ? '' : `${direction.value} · `}
              {direction.name}
            </Heading>
            <p style={{ margin: 0, maxWidth: 860 }}>{WHAT[direction.value]}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 20, marginTop: 8 }}>
              {mine.map((shot) => {
                const picture = pictureOf(shot.id)
                return (
                  <figure key={shot.id} style={{ margin: 0, display: 'grid', gap: 6, alignContent: 'start' }}>
                    {picture === undefined ? (
                      <span>{shot.id}: not taken yet (node shoot.mjs)</span>
                    ) : (
                      <a href={live(shot.page)}>
                        <img
                          src={picture}
                          alt={shot.caption}
                          style={{ width: '100%', display: 'block', border: '1px solid var(--line)', borderRadius: 8 }}
                        />
                      </a>
                    )}
                    <figcaption style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <strong>{shot.id}</strong> {shot.caption}
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          </section>
        )
      })}
      <section style={{ display: 'grid', gap: 12 }}>
        <Heading level={2}>Which I’d pick</Heading>
        <p style={{ margin: 0, maxWidth: 860 }}>
          C, with “Show the address as its key” on (C9, C10). The card sits right under the bubble, at its width and on its side, and “just
          now” comes after it, so words, card and time read as one message; the key in place of the raw address takes the noise out of the
          words without repeating a whole card. The card stays whole, with status, priority and team. It is also the smallest change: the
          kit’s You already has the unfurl slot, and ThreadBlocks would pass the cards to it instead of drawing them after. A nests a frame
          in a frame and always widens the bubble; B shows the card before the words that explain it; D hides what the issue is behind a
          hover and breaks sentences in the narrow column; E is the lightest, and could be how C shows three links or more.
        </p>
      </section>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<Compare />)
