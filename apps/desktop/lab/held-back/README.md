# Held back lab

Up next, its rows and a waiting task's own view while This Mac lets fewer agents work than the person's number
(`LoadAgents.atOnce` < `configured`, with `why`), drawn on the app's own board (`BoardView`) and task view (`TaskView`)
with no runtime. The kit reaches the app through `kit.ts`, which hands it the kit as it is but for `NextRow`, `NextLine`,
`BoardColumn`, `TaskHeader` and `Behind`, each the kit's own component wrapped (`wrapped.tsx`) so a direction can say what
is held back. Nothing in `src` or `packages` changes.

Run it from `apps/desktop` (or Run › Held back lab):

```sh
../../node_modules/.bin/vp dev --config lab/held-back/vite.config.ts
```

It answers at http://localhost:6171.

## The directions

Held back: the tasks in line that would be at work now with the person's number, the first `configured − busy` of them.
What waits past those waits for an agent to finish anyway. Every direction lets a held row start now (Start anyway, in its
line's place on hover, as Start is for a held plan): the person's own start, which never waits (scheduling.md, order 1).
Every direction but As built says the same in the task's own view: its header "Held back until memory frees up", why on
hover, and the chip over its composer "Held back", with Start anyway in its popover.

- **0 · As built:** "Next in line", and the header "Waiting · 1 agent busy".
- **A · Rows:** each held row says "Held back until memory frees up", warm, as the meter is.
- **B · Group:** a divider over the held rows, as Planned and Paused are: "Held back until memory frees up", and at its end
  "1 of 4 at a time", which opens This Mac; a divider over the rows past them, "Waiting for an agent to finish". Rows keep
  their place words.
- **C · Room:** Running ends with the room held back, drawn as an empty card: how many more could work, until when, the next
  task and Start anyway.
- **D · Heading:** Up next's heading says "1 of 4 at a time", warm; it opens This Mac's own popover with the held tasks
  after it, each with Start anyway.

## Keys

0 A B C D the direction · Q W E R the scene (memory, the CPU, crowded, calm) · T the task first in line · N narrow ·
K dark · P This Mac from the bar.

`still=1` turns transitions off; `open=tag|chip|mac` opens D's heading, the task's chip or This Mac as the page loads.
`node lab/held-back/shoot.ts`, run outside an agent's sandbox with the lab running, shoots every direction into `shots/`
(git ignores it).
