<img src="docs/assets/readme-header.png" width="100%" alt="Althar. The project should persist. The agents should not have to." />

Althar is an open-source desktop app for coding with agents. It runs Claude Code, Codex and OpenCode side by side, on the plans you already pay for. Each project gets a coordinator that turns what you ask for into tasks and picks who implements and who reviews. When one agent hits its limit, the next carries on. You step in only when something needs you.

> [!NOTE]
> **Early.** Althar runs from source on macOS. There's no release yet, and things will change.

## What it does today

- **Your agents, in one app.** Claude Code, Codex and OpenCode, each on the sign-in already on your machine: your Claude plan, your ChatGPT plan, your keys. Several accounts per agent, and one picker for any agent's model and effort.
- **A coordinator for each project.** Ask it about the code, or say what you want changed. It plans a task: who implements it and who reviews it. The plan starts on its own unless you change it or hold it.
- **Tasks that review themselves.** The lead implements, another agent reviews, and the lead settles what the review found, for up to three rounds. Then the task opens a pull request. At any point you can talk to the lead, change its model or hand the task to another agent.
- **Work that carries on without you.** When an agent hits its usage limit, the work moves to the next agent with room, or waits for the reset, as the project's rules say. A turn that stalls is carried on, then started afresh, then brought to you. The rules also say what agents may do without asking.
- **You, when it's yours.** A board with every task by lane: up next, running, needs you, settled. A task's change, file by file, before you accept it. A notification and a Dock badge when something needs you.
- **GitHub and Linear.** Issues in, pull requests out.

More agents join through the Agent Client Protocol: each one takes an adapter, not a rewrite. Gemini isn't one of them yet.

## Run it

You need macOS, Bun 1.3.5, Node 24 and git. Sign in each agent you want to use with its own tool first: `claude auth login`, `codex login` or `opencode auth login`. Then, from the repository:

```bash
bun install
```

```bash
bun --filter @althar/desktop dev
```

That builds the app and opens it. The start screen shows which agents are ready. There's also a command-line client, [`apps/cli`](apps/cli), which runs a task in a terminal. [DEVELOPMENT.md](DEVELOPMENT.md) has the rest.

## Why

The best coding agent right now won't stay the best for long. New models ship most weeks, open models keep closing the gap, and prices, limits and terms move with all of it. [The site keeps a list](apps/site/src/content/shifts.ts) of what changed since August. Tying your work to one agent is a bet.

Althar doesn't make that bet for you. It runs the agents you have side by side, and keeps the project in one place: its tasks, its rules and what happened. Agents come and go; the project stays.

Model providers will build good orchestration around their own agents. Developers have a different incentive: to use whichever agent is best for the work. So Althar aims to let you:

- mix agents from different providers in one project, and switch between them mid-task
- keep project data portable and inspectable, on your own machine
- see and change how orchestration works
- keep what the project has done when a better model or tool appears

## How it works

| | |
| --- | --- |
| **Project** | A folder you open in Althar, usually a repository, with its own rules, tasks and history. |
| **Coordinator** | The project's agent that you talk to. It answers questions, plans tasks and hands them out. It never writes code itself. |
| **Task** | One piece of work with an outcome, usually one change, in a worktree of its own. |
| **Lead** | The agent that owns a task. It implements, runs the task's steps, such as review, and settles what they find. Each step can use a different agent. |

Agents work under the project's rules. You're pulled in only when something needs a person to decide.

## The thesis

Althar tests a broader hypothesis about how software engineering changes once coding agents are abundant. The argument, the questions it raises and the evidence we hope to collect are in **[THESIS.md](./THESIS.md)**. Treat Althar as an experiment that comes out of that thesis, not as proof of it.

## Read more

- **[The architecture](./docs/architecture/README.md):** how Althar is built. It's a local-first desktop app that runs Claude Code, Codex and OpenCode through one protocol, with room for a cloud later.
- **[Decisions](./docs/decisions):** what has been decided, and why.
- **[Open questions](./docs/open-questions.md):** what hasn't been decided yet.
- **[Development](./DEVELOPMENT.md):** how to set up, run and change the code.
- **[The site](./apps/site):** the developer page, the list of shifts and the thesis.

## Contributing

Althar is early. The most useful thing you can do now is use it and tell us what breaks, in [an issue](https://github.com/thetastemakers/althar/issues). Before changing code, read [DEVELOPMENT.md](DEVELOPMENT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Licence

Althar is meant to be open source, but no licence has been chosen yet. Until one is added, all rights are reserved.
