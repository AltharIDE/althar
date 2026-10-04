<img src="docs/assets/readme-header.png" width="100%" alt="Althar. The project should persist. The agents should not have to." />

Althar is an open-source environment for running software projects with AI coding agents. It keeps the project in one place: its rules, knowledge, decisions, tasks and history. That place outlasts any single agent session. The work goes to whichever agents suit it, such as Claude Code, Codex or OpenCode, as installed on your machine.

> [!NOTE]
> **Very early.** There is no runnable Althar yet. This repository holds the thesis, the architecture, the interface primitives and the brief. The model, and the words for it, will change as we prototype.

## Why

Today, the useful context from AI-assisted work collects inside individual agent sessions, one developer's chat history, and whichever tool or model was in use at the time. Change the model, the tool or the person, and much of it is lost.

Althar makes the **project** the thing that persists. Agents come and go. They start from what the project knows and leave behind what they learned.

## How it works

| | |
| --- | --- |
| **Project** | A body of work with its own rules, knowledge and history. It owns everything below, and it may span several repositories or none. |
| **Coordinator** | The project's agent that you talk to. It plans and orders tasks, hands them out, answers questions and follows the work. It never writes code itself. |
| **Task** | One piece of work with an outcome, usually one change. |
| **Lead** | The agent that owns a task. It implements, runs the task's steps, such as review and verify, and settles what they find. Each step can use a different model. |
| **Knowledge** | What the project holds: notes that every task starts with (decisions, conventions, architecture), and what individual tasks noticed along the way. |
| **Artifacts** | What a task produced that is worth keeping but doesn't belong in a repository. |

Agents work under the project's rules. You're pulled in only when something needs a person to decide.

## Open by design

Model providers will build good orchestration around their own agents. Developers have a different incentive: to use whichever agent is best for the work. If a project's knowledge, workflows and history become some of the most valuable parts of how a team builds software, that layer shouldn't belong to one provider.

Althar aims to let you:

- mix agents from different providers in one project, and switch between them mid-task
- keep project data portable and inspectable
- see and change how orchestration works
- keep what the project has learned when a better model or tool appears

## The thesis

Althar tests a broader hypothesis about how software engineering changes once coding agents are abundant. The argument, the questions it raises and the evidence we hope to collect are in **[THESIS.md](./THESIS.md)**. Treat Althar as an experiment that comes out of that thesis, not as proof of it.

## Read more

- **[The architecture](./docs/architecture/README.md):** how Althar is built. It's a local-first desktop app that runs Claude Code, Codex and OpenCode through one protocol, with room for a cloud later.
- **[Decisions](./docs/decisions):** what has been decided, and why.
- **[Open questions](./docs/open-questions.md):** what hasn't been decided yet.
- **[Development](./DEVELOPMENT.md):** how to set up, run and change the code.

## Licence

Althar is meant to be open source, but no licence has been chosen yet. Until one is added, all rights are reserved.
