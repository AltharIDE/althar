# ADR-010: The desktop app is MVVM, in feature folders

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** The desktop app's renderer shows the runtime's state and sends
  it commands. Its components come from `@althar/ui`, which is
  presentational by rule. The logic between the components and the runtime
  needs a place that is easy to find and to test.
- **Decision:**
  - The renderer is layered: **views**, then **view models**, then the **data
    layer**. Each layer depends only on the one below it.
    - **Views** are React components. They compose `@althar/ui`, render
      what their view model returns, and call its intents. They hold no app
      logic.
    - **View models are hooks** (`useTaskThread`, `useBoard`). A view model
      turns data into what a view shows, and user intent into commands. It
      never renders.
    - **The data layer** is written with Effect
      ([ADR-009](009-effect-on-the-runtime-side.md)). It holds the RPC client
      to the runtime, subscriptions to the change feed, and caches. It is
      reached only through view models, which see plain values, promises and
      subscriptions, never Effect types.
  - Code is organised by feature: `apps/desktop/src/features/<feature>/`
    holds that feature's route, views, view models and tests together. Code
    that several features share lives in `src/shared/`, and the data layer in
    `src/data/`.
  - Routing uses TanStack Router, with type-safe routes and search
    parameters. Each feature owns its routes.
  - Tests: view models are tested as hooks against a fake data layer; views
    through Storybook stories fed with view-model output.
- **Alternatives considered:**
  - Components calling the data layer directly: logic spreads through the
    views and can only be tested by rendering.
  - A global store (Redux, Zustand) as the model: a second copy of state the
    runtime already owns, and a store that every feature reaches into.
  - Folders by kind (`components/`, `hooks/`, `routes/`): a feature is spread
    across the tree.
- **Trade-off:** more files per feature than putting everything in the
  component, and a boundary between Effect and React that needs a small
  adapter.
- **Revisit when:** view models grow into shared state that features fight
  over, or the renderer gains a second kind of client.
