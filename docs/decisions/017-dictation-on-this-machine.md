# ADR-017: Dictation runs on this machine, with a model downloaded on the first press

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** The composer had a microphone that did nothing (DEV-27), and
  the window refused every web permission. People want to talk to the lead
  and the coordinator instead of typing, and the transcription they compare
  with is the best there is: OpenAI's, or Claude Code's own `/voice`, both
  on someone else's servers. Althar is open source and hosts nothing. What
  someone says about their code is as private as the code.

  In 2026 open speech models are close to the hosted ones for clear speech.
  NVIDIA's Parakeet TDT 0.6B v3 is near the top of the Open ASR Leaderboard
  (about 6.3% average word error, against Whisper Large v3 Turbo's 7.6%),
  covers 25 European languages with punctuation and capitals, and runs on a
  laptop's CPU about twenty times faster than real time. sherpa-onnx runs it
  from Node through a native addon (N-API, so Electron needs no rebuild),
  with prebuilt binaries for macOS (Apple silicon and Intel), Windows (x64)
  and Linux (x64 and arm64). Its maintainers publish an int8 build of 670 MB.
- **Decision:**
  - **Dictation is local, always.** Speech is turned into text on this
    machine and never leaves it. There is no hosted transcription: not
    OpenAI, not OpenRouter, not a key the person brings. The only thing
    dictation fetches is the model.
  - **The model comes down only when someone asks for it.** Pressing the
    microphone the first time opens a tray on the composer's top (the kit's
    `DictationTray`) that says what dictation needs and how big it is.
    Nothing downloads until they press Download. The microphone is asked for
    first, so a refusal costs nothing.
  - **One pinned model, checked.** Parakeet TDT 0.6B v3 int8, its four files
    from one pinned revision, each checked against a SHA-256 written in the
    app (`src/speech/model.ts`). A download carries on from where a dropped
    connection stopped, checks there is room on the disk before it starts,
    and counts the model as there only once every file is checked. Cancel
    keeps nothing. It is kept in the profile (`speech/`), so every window
    and every launch shares it.
  - **Its own process.** The main process starts a speech utility process
    the first time someone dictates or downloads, and stops it once it has
    sat idle for ten minutes. A native addon failing never takes the
    runtime's agent sessions with it, and the model's memory (about a
    gigabyte) goes when the process does. Whether the model is there, the
    main process reads from the folder, so a window that never dictates never
    starts the process.
  - **The window records; the main process holds the rest.** The window
    records mono audio at 16 kHz in memory and sends it to be written down
    when the person stops. The main process asks the system for the
    microphone (macOS asks once; Windows has a setting; Linux has neither),
    opens the system's own settings when it was refused, and grants the
    window's web permissions: the microphone, for audio alone, in Althar's
    own windows, and nothing else.
  - **What was said lands at the cursor, never sent.** Escape while
    listening throws it away. The model loads while the person talks, so the
    first words don't wait for it.
- **Alternatives considered:**
  - Hosted transcription with the person's own key (OpenAI's GPT-Transcribe,
    or OpenRouter's audio endpoint): the best quality on accents and noise,
    and no download. Rejected: speech would leave the machine, and Althar
    would carry a network dependency it otherwise doesn't have.
  - Riding the person's ChatGPT or Claude sign-in, as the Codex app and
    Claude Code do for their own dictation: no setup, but through
    undocumented endpoints, and the same objection.
  - The system's own dictation (macOS's Fn Fn already works in the field)
    or its speech API (SpeechAnalyzer on macOS 26): no download, but on one
    system only, with no say in quality, and nothing to show in the
    composer while it listens.
  - The browser's speech API: Electron doesn't ship Chrome's speech service.
  - Whisper (whisper.cpp): 99 languages, but slower and less accurate than
    Parakeet for the languages most people here use, and it can invent
    words over silence.
  - A small model first and the full one after: dictation in seconds, but
    two downloads and two qualities to explain. Prototyped, and not chosen.
  - The single 487 MB archive instead of four files: smaller, but needs a
    bzip2 decoder, can't carry on file by file, and is checked only whole.
  - Transcribing in the runtime's process: one process fewer, but a native
    crash would end agents' sessions, and the model's memory would stay for
    as long as Althar runs.
- **Trade-off:**
  - A 670 MB download before the first dictation, and about a gigabyte of
    memory while dictating.
  - Hosted models still do better with heavy accents, noise and mumbling.
  - 25 European languages, not every language.
  - No words as you speak: the text arrives when you stop, a fraction of a
    second later for a sentence.
  - Windows on Arm has no prebuilt binary yet.
- **Revisit when:** an open model clearly beats Parakeet on code-heavy
  speech, a streaming model is good enough to show words as they are said
  (NVIDIA's Nemotron streaming models are close), sherpa-onnx ships Windows
  on Arm, or people ask for languages Parakeet lacks.
