# The home lab

A project's real home, on made-up data with no runtime: `ProjectView` with its header, coordinator conversation, composer and board, laid out by `main.tsx` through ProjectView's `arrange` prop. It is for choosing how the board and the conversation close and come back.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/home/vite.config.ts
```

At `http://localhost:6141`. Keys 1–5, or the bar along the bottom, swap the direction (A–E); `c` and `b` close and open the conversation and the board, or switch between them where only one fits; `w` switches between wide and narrow (760 px), `t` between light and dark. What each direction leaves open is kept in local storage per project, as the app would keep it.

- **A, close buttons on the split.** An × on each pane. A closed conversation leaves a strip with a button to bring it back. A closed board folds to its rails, with Needs you still open, and pressing a rail brings it back.
- **B, toggles in the header.** A Conversation toggle and a Board toggle, plus Swap sides. A closed conversation leaves its composer under the board; sending opens the conversation for the answer. A closed board leaves a count on its toggle.
- **C, the board opens beside the conversation.** The conversation is home. The board opens where a page or file opens, in a resizable panel. In a narrow window it covers the conversation.
- **D, the conversation is a drawer.** The board is home, with the composer floating at its foot. The conversation slides in over the board (pin it to sit beside the board instead). In a narrow window it covers the board.
- **E, one at a time.** A Conversation | Board switch in the header, a dot on Board while something needs you; the board keeps the composer.

`shoot.ts` shoots each direction's states into `lab/home/shots` (git ignores it), with the lab running (Chromium can't start in an agent's sandbox on a Mac, so run it outside):

```bash
node lab/home/shoot.ts
```
