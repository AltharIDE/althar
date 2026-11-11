# The Scratch lab

Where Scratch (the chats: a task that is only a conversation) lives, and what it is called, in directions drawn into the app's own project window (`ProjectView`, its board and its conversation, `TaskView` for a chat opened as a task), from the tests' fixtures, with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/scratch/vite.config.ts
```

At `http://localhost:6147`. Keys, or the bar along the bottom:

- **A–E**, the direction: A today's "Scratch · N" chip; B a Chats view of the project's own; C Asides, tabs over the conversation; D a Chats tray from the window's bar (⌘J), every project's; E no place, chats quiet in the conversation where they began and on the board only while at work.
- **1–3**, the layout: both, the conversation alone, the board alone.
- In C, **4–8** the asides' bar: pills (picked), tabs, sheets, the conversation's title with its asides small beside it, or one switcher with the asides in its menu; **G H J K** the bar inside an open aside: a head row, its moves in the tab's ⋯, a row by the composer (picked), or a slim head that says where it came from.
- **T**, light or dark. Reset brings back what was cleared or made a task.

`node lab/scratch/shoot.ts` (or `… asides`, `… bars`) (outside an agent's sandbox, with the lab running) shoots each direction at 1× into `lab/scratch/shots`.
