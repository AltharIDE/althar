# @althar/ui — Architecture

This package holds Althar's interface components: the primitives (buttons, menus, popovers), the thread (messages, tool calls, steps, permissions), the composer, the coordinator's cards, the board, the dock beside it, the home's stream, a task's outputs, and the window's chrome. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target. This document adds what is specific to UI components. Where the code does not yet meet it, see **Gaps** at the end.

- **Owner:** Repository maintainers
- **Consumers:** the Althar desktop shell. The pitch app may adopt components later.
- **Dependency direction:** apps depend on this package; it depends on no app. Inside the package, see **Layers**.

## Layers

| Layer | What it holds |
| --- | --- |
| `foundations` | Tokens, icons, brand marks, project marks, `Model`, and the domain vocabularies. |
| `primitives` | General parts: buttons, menus, popovers, fields, panels, Heading, SidePanel, Skeleton (the shape of what is still being read), and Ask, which every part that asks a person shares. |
| `thread` | What appears in a conversation: turns, tool calls, steps, permissions, questions, Stuck, documents. |
| `composer` | What writes into a conversation: Composer, ModelPick, ContextRing, Listening, Running. |
| `coordinator` | What the coordinator shows about tasks: Issue, TaskLaunch, TaskCard, TaskMark, TaskHeld. |
| `board` | The project's work in lanes: Board, BoardColumn, and a card or row for each lane. |
| `dock` | What opens beside the board: Dock and a peek for each kind of card. |
| `home` | Work across every project, as the home shows it: HomeSection, NeedCard, RunRow, SinceRow, ProjectRow, ProjectWord. |
| `outputs` | What a task made: ChangeSet, ArtifactCard. |
| `chrome` | The window's own furniture: ProjectTabs, TitleBar, AgentMarks, ProjectSwitcher, RoomSwitch, TaskHeader, TaskMenu. |
| `setup` | What comes before a project, and what sets one up: Runtimes, ConnectAgent, SourceMap, Accounts, Connections, and Conventions (NamingRule, TemplateSources). |
| `screens` | Whole screens made from the layers above: Welcome, Launch (the window opening), Start, Home, NewProject, ProjectRules. |

The rules between them:

- `foundations` ← `primitives` ← the nine middle layers ← `screens`. A layer imports only from layers before it in that chain.
- The nine middle layers don't import each other. Where one needs another's part inside it, it takes a slot and the consumer fills it: StepPanel's composer is a slot.
- Nothing imports `screens`. It is exported on its own entry (see **Public API**).
- `fixtures` and `storybook` serve stories, tests and the workbench. Nothing else in `src` imports them. `fixtures/models.ts` stands in for what a consumer owns: the demo models, runtimes, pins and default efforts.
- A screen is made of the real components, not pictures of them. Content a screen ships with, like the welcome's demo project, lives beside it, not in `fixtures`.

## Principles

### Components are presentational and composable from outside

A component renders what it is given and reports what happened. It does not fetch, persist, subscribe to app stores, or know which project, task, or model catalogue it is in.

- **Data comes in as props, already resolved.** A component takes a `ModelInfo`, not a model id it then looks up in a registry. Lists, counts and names are props. The same goes for how something is drawn: `Model`, `Listening` and `Arrived` take a `Brand`, not a lab or a source kind that they would map to a mark themselves.
- **Data never lives in a component file.** Drawings, lookup tables and registries each get their own module: brand drawings in `foundations/brands/brands.ts`, which lab or source takes which mark in `foundations/brands/resolve.ts`, and the icon table in `foundations/Icon/icons.ts`. A component file holds the component, its props, and its `text`. The consumer, or a fixture standing in for it, calls the lookups and passes the result down.
- **Effects go out as callbacks.** Examples are `onSelect`, `onAnswer`, `onStop` and `onTogglePin`. Nothing inside writes to storage or calls a service.
- **Local UI state is fine, and replaceable.** Examples are whether a fold is open, which option is highlighted, or a draft in a field. Where a parent may need to drive that state, offer the controlled pair (`open` / `onOpenChange`) alongside an uncontrolled default (`defaultOpen`). `useControlled` (`src/lib/controlled.ts`) does the wiring, and everything that folds takes the `Disclosable` props and uses `useDisclosure`.
- **The root takes what its element takes.** A component spreads the rest of its props, `ref` included, onto its root element, typed with `RootProps<'element', OwnProps>` (`src/lib/props.ts`). A consumer can add an id, a data attribute, a handler or a ref without the component growing a prop for it.
- **No dead controls.** A button whose action belongs to the consumer, like Quote, Open in the editor, Undo, or Connect a runtime, renders only when its callback is given. A component never shows a control that does nothing. Where there is nothing to open, what would have been a link or a button is plain text.
- **Answers go out at once, and the consumer keeps them.** Something that asks (a permission, a question, a proposal) calls back as soon as it is answered, can be driven with `answer` / `defaultAnswer`, and offers Undo only through `onUndo`. Any motion as it folds away is the component's own and never delays the callback.
- **Slow work has its states.** When an action goes out to the consumer and may take time or fail, the component takes a pending flag (`accepting`, `recording`, `creating`) and an `error` to show. It does not guess at either.
- **Say what is wrong rather than disable.** A submit button stays pressable. Pressed with something missing, it says what, beside the field, and focus goes to the field.
- **Build on what exists.** Where a primitive or another component already does the job, use it and compose from it. Don't draw it again in the component's own markup and CSS. A component styles what it uses only to place it in its context. If the existing piece doesn't quite fit, extend it rather than copying it.
- **Composition over configuration.** Prefer `children` and slots (`above`, `trigger`, `card`) to growing lists of flags. For example, the Composer does not know about models: its `picker` and `meter` slots take a ModelPick and a ContextRing, which the consumer wires to its own state. A component that needs a new variant for one caller usually needs a slot instead.
- **Context only for host services.** Examples are opening a document, an image or a step's thread beside the thread (`ThreadShellProvider`). Every service is optional, and a control that needs one is left out when the host has not given it, so every component renders alone in a story.

### No raw strings inside components

Every word a component shows or announces, including accessible names and live-region text, comes from the parent. There are two routes, in order of preference:

1. **A prop**, when the text is content: a message body, a title, a command.
2. **A `text` prop with English defaults**, when the text is the component's own copy. Examples are "Copy", "Worked for 12m", "Stop listening to PR 1206" and "Needs your permission".

Each component with its own copy exports its shape and its defaults, and interpolations are functions:

```ts
export interface WorkedForText { took: (duration: string) => string }
export const workedForText: WorkedForText = { took: (d) => `Worked for ${d}` }

export function WorkedFor({ text, ...props }: WorkedForProps) {
  const t = { ...workedForText, ...text }
}
```

The prop named `text` is always the component's copy. Content that happens to be text gets another name: `content` for streamed prose, `value` for what CopyButton copies, `question`, `label`.

Translations live in the consumer. It passes `text` from its own translation files, or wraps components once to do so. The English defaults exist so that stories and the workbench read naturally. They are not the product's copy source.

The same holds for formatting: dates, durations, counts and file sizes arrive formatted.

### Types: enums for vocabularies, unions for looks

- **Domain vocabularies are string `enum`s,** in `src/foundations/vocabulary.ts`: `ToolKind`, `ToolState`, `StepState`, `TaskStatus`, `PermissionPolicy` and the like. String values keep data and stories readable.
- **Where a protocol has a vocabulary, ours covers all of it.** `ToolKind` has every ACP tool kind, and `ToolState` adds Declined and Cancelled to ACP's statuses.
- **Open-ended sets stay strings.** A runtime id is one, because consumers add runtimes.
- **A vocabulary offered as a choice in more than one place has its words once,** in `src/foundations/vocabularyText.ts`, so a setting reads the same wherever it is changed.
- **Visual options stay string-literal unions:** `variant`, `tone`, `size`, `placement`, `align`. They read naturally in JSX (`variant="signal"`), and are the component's own business.
- **Branch on a vocabulary with an exhaustive `switch`,** ending in `default: return unreachable(value)`, so a new member fails the build wherever it isn't handled. No chained ternaries, and no lookup tables whose keys can drift from the type.
- **A `Record<Enum, …>` is fine for a pure table** where the compiler checks every key, like per-state copy in a `text` object.
- **Data whose fields depend on its kind is a discriminated union,** so each kind carries exactly what it needs and nothing can be half set: a runtime's state, a graph change's cause, a diff line.
- **Items in a list carry an `id`,** which is their key. Labels and names are not keys: two can match.
- The repository's rules apply unchanged: strict mode, no `any`, no non-null assertions, no unchecked casts.

### Styling: CSS Modules and tokens

- **One folder per component,** holding `Component.tsx`, `Component.module.css` and `Component.stories.tsx`. A small family that is always used together, like `Menu`, `MenuItem` and `MenuRadioGroup`, may share a folder.
- **Global CSS is only tokens and a zero-specificity base** (`src/styles`). The base's resets and focus ring are wrapped in `:where()`, so any module rule wins. There are no global class names, apart from `ch-root`, which carries type into portals and the top layer.
- **Colour is semantic, and each colour has one meaning:**
  - cobalt `--live` is work in motion
  - violet `--signal` is a decision that waits on a person
  - green is only for additions and merges
  - `--danger` is only for deletions and failures
  - source colours, like `--linear`, are only for that source's mark
  - project inks, `--project-*`, are only for a project's mark
- Visual rules from the product voice apply. There are no side stripes, coloured shadows or badge pills, and there is no selling copy.
- **Text meets contrast.** `--t-4` is for disabled text and decoration, never for information.
- **Spacing between parts belongs to the layout, not the parts.** A part never sets its own top margin in a thread. Its root carries `data-rhythm` (the `Rhythm` enum in `src/lib/rhythm.ts`), and `Thread` and `Turn` space parts from it:
  - a new turn is 30px from the last, and parts inside a turn are 14px apart
  - steps stack 12px apart; a steer, graph change or allowed line sits 8px from its step
  - graph changes, runs of tools, snippets and external calls stack tight
  - your consecutive messages are 6px apart
  - a closed fold is followed at 8px

  The layout rules use `> :not(:first-child)` rather than `> * + *`, so their specificity (0,2,0) beats a part's own margin reset whatever order the modules load in. A host that places parts outside a Thread wraps them in one.
- **Stacking has four levels,** as tokens: `--z-float` for what floats over the page, `--z-dialog` for a modal and its scrim, `--z-popover` for what a modal opens, and `--z-tip` for what that opens. Nothing uses a raw z-index above 3; small values only order siblings inside one component.

### Behaviour: Radix primitives, our look

Widgets with real behaviour are built on Radix primitives (`radix-ui`), styled through the module classes on their parts. Radix brings keyboard handling, focus management, dismissal, and positioning that stays on screen.

| Radix primitive | Ours |
| --- | --- |
| Popover | Popover |
| DropdownMenu | Menu, TaskMenu |
| Tooltip | HoverCard, and Tooltip for a name or a shortcut that only shows on hover. Both open for keyboard focus too. |
| Dialog | ModelBrowser, Lightbox. The title sits in `VisuallyHidden` when it isn't shown. |
| (none) | SidePanel, which is ours: see below. |
| Select | Select (`position="popper"`) |
| RadioGroup | Segmented, Choices, ModelPick's list, ModelBrowser's filters |
| Checkbox | CheckList |
| Tabs | StepPanel |
| Collapsible | Disclosure / Fold. Content is force-mounted so it can animate, and `inert` while closed. |
| Accordion | SubAgents |
| Toggle | The pin in ModelBrowser |
| VisuallyHidden | VisuallyHidden |

Plain semantic elements stay plain. A button is a `<button>`, and a list is a `<ul>`.

**SidePanel** is not modal. It sits beside the thread or the board, takes focus when it opens, and gives it back when it closes.

**Escape goes to the innermost thing first.** Radix hears Escape on the document before anything inside can stop it, so a Popover takes `onEscapeKeyDown` to let something inside go first, and a field marked `data-own-escape` gets the same without a handler. SidePanel hears Escape last.

### Icons and marks

- **Icons are Iconoir** (`iconoir-react`, MIT). They are named by what they mean in Althar (`work`, `after`, `corner`), not by their drawing. `Icon` sets a stroke width that holds up at 11–14px.
- **Marks are brands, drawn in ink.** `BrandMark` draws a `Brand` from `foundations/brands/brands.ts`. That file is generated from Lobe Icons (MIT) and Simple Icons (CC0). Brand colour is not used, apart from Linear's issue card.
- **A project's mark is generated, never chosen from pictures.** `ProjectMark` draws a composition from a seed that survives renaming, in one of the project inks, so every project has a mark from the moment it exists.

### Shared building blocks

A pattern that appears in two components becomes one part, so the two cannot drift. The parts:

| Part | What it is | Used by |
| --- | --- | --- |
| Ask (`AskCard`, `AskFoot`, `AskAnswered`, `AskNote`) | A card that waits on a person, and the line it folds to once answered | Permission, GraphProposal, Question, Stuck, and the home's answered calls |
| SidePanel | What opens beside a thread or the board | DocPanel, StepPanel, Dock |
| TaskGlyph | Where a task stands, as a glyph | TaskCard, WorkCard, TaskHeader, WorkPeek |
| FileChanges, Delta, DiffStat | Files a change touched, with lines added and removed | ChangeSet, AcceptPeek, and a tool call's meta |
| Checks | A change's checks and reviews | ChangeSet, AcceptPeek |
| NoteForm | A one-line note sent with an action | ChangeSet, AcceptPeek, Review, Stuck |
| Field | One line of text to type | NoteForm, SourceMap, NewProject, and every other typed answer |
| Panel, FormRow | A sheet of settings, and its label-beside-control rows | ProjectRules, NewProject |
| KeyValues | A small definition list | External, GraphProposal |
| StepRow | A step's row, its track and its thread link | Step, Review |
| StepTrack | A task's steps as a row of bars | TaskCard, WorkCard, TaskHeader |
| Heading | A heading at the level the consumer gives | everything with a title |
| Markdown | Markdown drawn as our own elements, never as HTML | Document, DocPanel, FileArtifact |

The helpers, in `src/lib`:

- `useControlled`: a value a parent may drive, or leave to the component.
- `useOnScreen`: a clock that runs only while someone can see it.
- `useStickToBottom`: a thread that follows new content until you scroll away.
- `useRefocus`: focus back on the button a form replaced, when the form closes.
- `safeHref`: the one test for whether an address becomes a link.

### Accessibility is part of the component

The target is WCAG 2.2 AA, per the root document. In a component that means:

- Semantic elements first; ARIA only where HTML has no equivalent.
- Every control has an accessible name. The visible label is part of that name (WCAG 2.5.3).
- There is full keyboard operation, and focus is visible and returns sensibly: Escape sends it back to the trigger.
- Motion respects `prefers-reduced-motion`.
- Live changes are announced politely: arrivals, copy confirmation, and streaming completion via `aria-busy`. Something that counts down is announced once, not every tick.
- Focus is never lost. When an answer folds a card into its answered line, focus moves to the line. When a form that replaced a button closes, focus goes back to the button.
- Keyboard shortcuts listen inside the component, never on the window, so they cannot take keys from the rest of the page.
- A name or shortcut that only shows on hover is a Tooltip, never a `title` attribute.
- A component that titles itself takes `headingLevel`, because the outline belongs to the page it sits in.
- Links go out only to http and https addresses, open in a new tab, and say so. Anything else is shown as text.
- No interactive element sits inside another.

### Every component has stories, and every state is one

- **Storybook is the component catalogue.** Every exported component has a `*.stories.tsx` beside it.
- **Every state someone will meet is a story:** rest, hover, focus, pressed, disabled, busy, selected, open, empty, error, long content, and at the viewport edge. Every stories file ends with an `AllStates` story that lays them out in the `States` grid (`src/storybook/States.tsx`). Interaction states are forced with `storybook-addon-pseudo-states`: a cell's `force` sets the whole cell, and `statesOn({ hover, focus, pressed })` puts the state on one part of the component, such as a single option of a radio group.
- **Behaviour is specified in `play` functions,** for example that Escape returns focus, arrows move, or Enter submits. Those play functions also run as tests.
- The accessibility addon runs on every story with `test: 'error'`.
- Stories use the shared demo world in `src/fixtures` (one project, one task), so components are seen together as they will be used.

### The workbench

The workbench (`workbench/`, `bun run workbench`) is where components are seen in use rather than one at a time. It holds the specimen catalogue, where one thread shows each state named in the margin, and the example conversations. It sits outside Storybook's one-component-per-story model on purpose. It is also exposed as Storybook stories under **Workbench**. The workbench composes package components only. If it needs markup that isn't a component, that is a sign a component is missing.

## Public API

- `@althar/ui` exports components, their prop and `text` types, their default `text`, and the enums, all from `src/index.ts`.
- `@althar/ui/screens` exports the whole screens, from `src/screens/index.ts`. They are one product's compositions, kept off the main entry so the parts' surface stays general.
- `@althar/ui/styles.css` provides the tokens and the base. The consumer imports it once and wraps its UI in `.ch-root`.
- Anything not exported from `src/index.ts` is internal. Until there is a second consumer, the API may change without a deprecation period; after that, breaking changes need an ADR.

## Checks

- `bun run check`: type-aware lint, format and type checks (`vp check`). Lint and format settings are in the repository root's `vite.config.ts` and apply to every workspace. A pre-commit hook (`.vite-hooks/pre-commit`, installed by `prepare`) runs `vp staged`, which fixes and checks the staged files.
- `bun run test:coverage`: Vitest in jsdom. It renders every story through `composeStories` and runs their `play` functions (`tests/stories.test.tsx`). Unit tests beside it cover what a play cannot reach: every Permission answer, the ModelBrowser keyboard, stream pacing, the pixel field and the thread's scroll. The gate is 90% lines and branches over `src/**`, excluding stories and fixtures.
- `bun run storybook` runs the catalogue with the accessibility addon. `bun run build` builds the static Storybook.

## Gaps

These are known departures from the principles above, with the way back:

- **The workbench** is not yet in the package, so neither is `bun run workbench`. The prototype's specimen, once migrated to these components, is the catalogue it should hold.
- **Plays that need a browser.** Testing Library in jsdom does not know `inert`, and cannot click a label that forwards a pointer event. Five plays run in Storybook only; they are listed in `tests/stories.test.tsx`.
- **The marks generator is not in the repository.** `brands.ts` says to regenerate rather than edit by hand, but the script that writes it lives outside the repo. It should move to `packages/ui/scripts/marks` as a Bun script that reads `simple-icons` and `@lobehub/icons-static-svg`.
- **Dictation recording is red.** The Composer's recording state uses `--danger`, which is kept for deletions and failures. It needs its own treatment.
- **Accessibility lint warnings.** `vp check` warns about some deliberate patterns: forms and panels that listen for their own keys (number keys, Escape), focusable scroll regions, a `role="status"` where the rule prefers `<output>`, and `role="group"` on a group that is not a form's fieldset. Each one has been reviewed. The warnings stay visible rather than being disabled.
- **Code colouring is built in only for TypeScript and JavaScript.** Other languages show plain unless the consumer passes a highlighter to CodeBlock. A real grammar-based highlighter belongs to the consumer until one is chosen for the package.
- **Images in markdown are shown as their words.** Markdown does not fetch images from a message; a consumer that wants them has no way in yet.
