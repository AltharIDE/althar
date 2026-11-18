# The device lab

Four takes on a task's iOS simulator or Android emulator beside its conversation ([proposed ADR-107](../../../../docs/decisions/proposed/107-a-task-gets-a-simulator-or-emulator-of-its-own.md)), on the app's own task thread and kit, with no runtime: a task on the phone app whose lead checks its pairing screen on an iPhone 16 and a Pixel 8 (`data.ts`). The device's screen is drawn in `Phone.tsx`, at its own points, as the phone app draws its first screen; it stands for the pixels Althar would stream from the device. Everything round it is the kit's: the workbench, SidePanel, the menus, Segmented and the buttons.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/device/vite.config.ts
```

At `http://localhost:6141`. The bar along the bottom, or its keys, swaps the direction in place: `A`–`D`. `S` shows the device starting in its place, then running; `U` puts the lab on a computer with no Xcode; `L` sets the lead at work on the Pixel, tapping "Where do I get a code?" and back, with the tap and the device's edge in cobalt; `N` narrows the workbench. The address keeps it all, for a screenshot: `?d=c&lead=1`, `?d=a&unavailable=1`, `?d=b&narrow=1`.

## The directions

- **A · Beside, as a page.** One device, at its own shape, on the workbench as the page is. Its head names it, and opens every model this computer can start; Take a screenshot and Show in Simulator sit at its end.
- **B · One place for what runs.** The dev server's page and each device are choices of one pane, so a task never has two things open beside it, and switching between Metro's page and either phone is one press.
- **C · Both at once.** The iPhone and the Pixel side by side, the same screen on each, for an app that must look right on both. The one the lead is using has the cobalt edge.
- **D · Screenshots first.** What the lead took, large, newest first, with the earlier ones in a strip, and the live device a press away in Simulator's or the emulator's own window. What can ship before Althar streams a simulator's screen into the window.

Where iOS can't run (`U`), A and B say what the person does about it and offer the Pixel; C keeps the iPhone's place with the same words; D shows only the Pixel's screenshots.

## Screenshots

`shoot.mjs` shoots each direction and the states that matter at 1×, into `lab/device/shots`, which git ignores, with the lab running. `LAB_CHROMIUM` names a Chromium of the computer's own where Playwright's own isn't installed:

```bash
node lab/device/shoot.mjs 1440 900
```
