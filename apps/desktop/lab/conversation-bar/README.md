# The conversation bar lab

Five takes on the bar over the coordinator's conversation (the Coordinator, then a tab for each aside), on the whole desktop app in the browser: its router, tabs and real screens, on made-up data with no runtime (`data.ts`: althar's board, its coordinator's conversation, and asides, one at work, the person's "hi", a long title and two a week old). One import seam in `vite.config.ts` gives `Asides.tsx` and `ProjectView.tsx` the lab's kit (`ui.ts`), where `AsideTabs` and `ProjectHeader` are each direction's (`Bars.tsx`). Everything else is the app's own: + starts a new aside for real, a tab opens it in the coordinator's place, its × clears it, Make it a task moves it to the board.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/conversation-bar/vite.config.ts
```

At `http://localhost:6177`. The bar along the bottom, or its keys, swaps the direction in place: `0` today's, `A`–`E` the five, `1`–`4` C again. `M` adds asides, for the crowded case; `N` narrows the window to the app's narrowest (880 px); `S` gives the asides the short names they would give themselves. The address keeps it all, and opens a state for a screenshot: `?d=c&open=merge-queue-reruns&menu=1`, `?d=e&new=1`, `?d=d&narrow=1&many=1`, `?d=c1&menu=1&q=rebase&named=1`.

## Why today's bar feels off

Everywhere else in the chrome, the chosen thing is a lighter sheet lifted off what it sits on: the window's tab, the room switch's Home. The bar's chosen pill is the one place drawn the other way, a darker fill (`--n-5`) with dark words, so it reads heavier than anything round it. And it is a second band of chrome over the conversation, under the project's row, where the board beside it has quiet lane headings at the same height.

## The directions

- **A · Segmented.** The room switch's own track and chosen sheet: a pale track, the open conversation white and lifted on it. The smallest change from today: pills still, drawn as the rest of the chrome draws a choice.
- **B · Underline.** No fills at all: the conversations as words on the bar's hairline, the open one in ink with a rule under it, the × in the gap after a tab when pointed at.
- **C · Heading and menu.** One name, set and placed as the board names its lanes, with no hairline, as a lane has none. The rest are a menu away: every conversation, a dot on those at work, when each was last spoken in, the older ones, New aside. While an aside is open, the Coordinator is a crumb before its name, one press back. A dot by the chevron says another aside is at work with the menu shut.
- **D · In the project's row.** No bar over the conversation at all: the conversations follow the project's name as crumbs (`althar / Coordinator`), the open one as heavy as the name, the others quieter. The conversation gains the bar's height. Where the row has no room, as in the narrowest window, they fold into C's menu.
- **E · Folder tabs.** The bar is the page, as the board beside it is, and the open tab is the conversation's own sheet rising out of it.

## C again

The person leaned to C, as reading most like the rest of the app, and asked for more of it, with a search among the conversations. All four keep C's heading and share one search over every conversation (`useSearch`): the finder's field and rows at a menu's size, the field keeping focus, ↑ ↓ to move, Enter to open, Escape to shut, and ⌘J from anywhere in the window. It finds a conversation by its name or by anything said in it, every word typed beginning a word there, those by name first; one found by what was said shows the line, the words that matched darker. New aside is at its foot.

- **1 · Search.** C as it was, its menu the search.
- **2 · Recents.** The heading, then the latest few other conversations as quiet words, one press each (the coordinator's first while an aside is open), as many as fit, three at most: C's one cost, asides a press away, made smaller.
- **3 · Lane heading.** Set as a lane heads itself: the coordinator's mark, the name, and at the end a count of asides in the lane's mono. Pressing the name turns it into the search's field in place, what it finds dropping under it. An open aside has a back chevron for the coordinator rather than a crumb, so its name has the room.
- **4 · Panel.** The heading opens every conversation in this one's place, down to the pane's foot, each with what was said in it last, as Scratch lists its chats; the board beside it stays.

A new aside's placeholder name leans 6° rather than italic: the app loads Inter's upright face only, so italic is the browser's own slant, steep at this size. `S` shows the asides with the names they would give themselves (`short` in `data.ts`), for when asides name themselves in a few words.

`check.mjs` drives each of the four's search by keys, headless, and prints what it found and opened.

## How they crowd

A, B, D and E share how they crowd: as many tabs as fit, the open one always among them, the rest in "N more" with the older ones, a dot on it when one of those is at work. Each tab's × shows only when it is pointed at, laid over its end, so the tabs are evenly spaced and every name is whole at rest.

## Screenshots

`shoot.mjs` shoots each direction in each state (on the coordinator, an aside open, a new aside, crowded in the narrow window, and C's and D's menus), the window only, at 1×, into `lab/conversation-bar/shots` (git ignores it), with the lab running; with `again`, C again's. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/conversation-bar/shoot.mjs
node lab/conversation-bar/shoot.mjs again
node lab/conversation-bar/check.mjs
```

Delete the lab once a direction is picked to build, before building it.
