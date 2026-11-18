# ADR-107: A task gets an iOS simulator or an Android emulator of its own

- **Status:** Proposed; a prototype of the runtime's tools and a design lab are built
- **Date:** 2026-11-18
- **Owner:** Runtime and desktop maintainers
- **Related:** [ADR-100, a web page beside the conversation](../desktop-app.md#a-web-page-beside-the-conversation), [Althar's tools outside the sandbox](../what-agents-may-do.md#althars-tools-outside-the-sandbox), [Local](../workspaces-and-runs.md#local), [proposed ADR-103](103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md) and [proposed ADR-106](106-builds-and-tests-share-a-host-resource-budget.md).

## Decision

A lead or the coordinator starts a device of its own beside its conversation, as it opens the page beside it: an iOS simulator Althar makes for it, or an Android virtual device run read-only. It installs its build there, opens links, reads and taps the screen, reads the log, and hands back screenshots as it does a page's. The device is never the person's own, and it goes when its task is done, when its project is removed and when Althar quits.

Althar runs the devices itself, outside the agent's sandbox, as it takes screenshots: CoreSimulator's services and adb's server are out of a sandbox's reach. The tools are served to the pool (ADR-097), asking nothing, and named `device_*` (`Devices.ts`).

## What runs where

| | iOS simulator | Android emulator |
| --- | --- | --- |
| macOS | With Xcode and an iOS runtime | With the Android SDK and an AVD; the Hypervisor framework |
| Linux | Never | With the SDK, an AVD and KVM; most VMs and containers have no KVM |
| Windows | Never | With the SDK, an AVD and Windows Hypervisor Platform |

`device_state` says what the computer can run and, where it can't, what the person does about it. A check that needs a device the computer can't run stays under Not checked. ADR-103's enrolled macOS worker is where an iOS check would go from a Linux host.

## A device of the task's own

- **iOS:** `simctl create "Althar · <task>"` of the model and runtime asked for, then `boot`, `bootstatus -b`, and the status bar set to 9:41, full and charged, so screenshots compare. A simulator named as Althar's that isn't one of this runtime's is a crash's leftover, deleted the first time one is made. The person's own simulators are never booted, changed or erased.
- **Android:** `emulator -avd <name> -read-only -no-window -port <n>` on the first even console port no device has, so several tasks run the same AVD at once and the AVD is left as it was; `adb wait-for-device`, then `sys.boot_completed`.
- **At most three run at once** on a computer, each taking 1.5 to 4 GB. Proposed ADR-106's pressure-aware admission should own this number once devices count toward it.
- **Everything goes with its owner:** settling a task closes its devices (the `settling` stream), and so does Althar quitting.

## What a lead can do

`device_state`, `device_open`, `device_install`, `device_launch`, `device_open_url`, `device_screenshot`, `device_snapshot`, `device_tap`, `device_type`, `device_press`, `device_logs`, `device_close`.

Android is driven whole: `uiautomator dump` reads the screen as elements with references, as `page_snapshot` does, and `adb shell input` taps, types and presses keys. An iOS simulator is started, installed on, opened at a link and screenshotted; reading and tapping its screen needs a driver, and the tools say so. Maestro is the candidate, as the phone app already plans to use it for its flows; idb is the alternative.

## Beside the conversation

The person watches the device as the lead uses it, on the workbench. The lab (`apps/desktop/lab/device`) has four directions: the device beside, as a page; one pane for the dev server's page and each device; both phones side by side; and screenshots first, with the live device a press away in Simulator's own window. The last can ship before Althar streams a device's screen: an emulator streams over its gRPC API, but a simulator's screen has no public stream, only repeated screenshots, a recording, or capturing Simulator's window.

## Open questions

- Which direction the person picks in the lab.
- Streaming an iOS simulator's screen into the window at a rate that feels live, and sending it touches.
- Whether `device_install` should take only a path inside the task's worktree or build folders.
- Builds: `expo run:ios` and `xcodebuild` in a worktree start with cold caches; ADR-091's Local, or a DerivedData kept per project.
- A run of the project that targets a device, so Run's list offers "iPhone 16" beside its address.
