# ADR-008: Shortcuts in behaviour, never in recorded facts

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** The proof of concept is due this week and the product the week
  after. It must become the product without a rewrite.
- **Decision:**
  - Build to product standard.
  - Shortcuts are allowed only in behaviour, and only where they are easy to
    fill in later. Recorded facts and data shapes are complete from day one.
  - If the facts are recorded, smarter behaviour is a later change. If they
    are missing, the history can't be recovered.
  - Examples:
    - Record process and session IDs, event order, and controller generation
      from the start. On restart, the first version marks in-flight work
      uncertain and asks.
    - Every task is a graph, even with one fixed workflow. Graph patches come
      later.
    - Permissions are answered by the rules alone.
    - One device, no cloud, built and tested on macOS first.
  - Details: [the architecture overview](../architecture/README.md).
- **Alternatives considered:**
  - A throwaway prototype: a rewrite before the product.
  - Full rigour everywhere before the first run: too slow.
- **Trade-off:** more work up front on storage and contracts, and some crude
  behaviour at first.
- **Revisit when:** a shortcut turns out not to be easy to fill in later.
