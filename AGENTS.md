# Working in this repository as an agent

[DEVELOPMENT.md](DEVELOPMENT.md) says how to set up, check and test. Before you finish a task, show that it works: [Showing a change works](DEVELOPMENT.md#showing-a-change-works) says how to screenshot a component's story or the desktop app, headless, and where the shots go.

A prototype goes on the prototype workbench, [`packages/prototype-workbench`](packages/prototype-workbench): one live page, drawn with the kit, its directions A, B, C… switched in place from a bar at the bottom, with their states. Not Storybook, and not an index page linking to a page per direction. Serve it with `bun run prototype <folder>` in the background and leave the server running when you finish: the person opens it from the task's Running pill. Give its address in what you report. Screenshots are secondary: take them from the live page with `bun run prototype:shoot`. [Prototyping](DEVELOPMENT.md#prototyping) has the rest.
