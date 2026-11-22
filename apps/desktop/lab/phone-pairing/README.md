# The phone pairing lab

Where Althar on a computer shows the code a phone pairs with: the QR, the home's print and three words beside it, the code to paste, its five minutes, waiting and paired; then the phones a home has paired, and taking one off. For This Mac and for a remote home (studio, over SSH). Four directions on the whole desktop app in the browser, on made-up data with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/phone-pairing/vite.config.ts
```

At `http://localhost:6189`. The bar along the bottom, or its keys, swaps in place:

- `A`–`D` the direction. A and B open on Settings › Computers, C and D on althar's board.
- `H` the window's home: This Mac or studio. `P` no phones, two, or many (long names). `R` a home no phone can reach yet. `Q` the shorter code (no certificate in it).
- `S` plays the phone pressing Pair; `X` runs the code's five minutes out.
- `N` the app's narrowest window; `T` dark.

The address keeps it all: `?d=b&home=studio&phones=none&theme=dark`.

## How it's made

The app is the real one. Two layers lay files over it at their own paths (`vite.config.ts`), each file ending in `.lab` so the desktop's type check and lint leave it be:

- `computers/`: the files of the task "Agents and workers beside This Mac, and Settings › Computers" as they stood at its head (`055f2c457`), so Settings › Computers, the bar's popover with its workers, and the Agents reading are as that task built them. Main hadn't changed any of those files since it branched.
- `seams/`: what this lab changes: Computers' section (A, B), the popover (C), the homes chip (D), and a phone icon.

`pairing/` is the lab's own: the panel every direction shows (`Pairing.tsx`), the phone rows, module and sheet (`Phones.tsx`), the made-up phones and codes (`world.ts`), the code as `althar-host pair` builds it (`code.ts`, a made-up P-256-sized certificate inside, so the QR is as dense as a real one), the home's print and words copied from althar-mobile's `src/ui/geometry.ts` (`print.ts`), and Nayuki's MIT QR encoder, vendored (`qrcodegen.js`).

## What every direction shares

The panel: the QR on a light tile (light in dark too, as a camera reads it best), "Waiting for your phone" with what's left of its five minutes under it; beside it "Scan it with Althar on your phone", the home's print and its three words ("Your phone shows this print"), which the phone's confirm screen asks the person to check, and the code to copy for the phone's Paste. Run out, the QR fades under New code. Paired, the print takes the QR's place with its point lit, as it lights on the phone, "iPhone is paired", Done and Pair another phone. A home no phone can reach says what that takes instead: This Mac, Let phones in; studio, the `althar-host configure-network` line to run on it.

## The directions

- **A · Beside the workers.** Settings › Computers gains Phones after Workers: a module each, as a worker has, "Connected / Open on it now" or "Away / Last here 2 days ago". Add a phone opens out in place, as a worker opens, to the panel; Done comes back with the new phone in the list. A phone opens out to its sheet (Opens, Paired, Device ID) with Remove at its foot, asked first.
- **B · Part of the home.** Phones belong to the home: its module says "Keeps your projects · Opens on 2 phones", and opened out it lists them under Agents at once, with Pair a phone opening the panel in a dialog. A phone opens to the same sheet as A's, its way back to the home.
- **C · In the popover.** The bar's This Mac popover lists the phones under the workers, and Pair a phone turns the popover into the panel in place, with a way back. A row opens the phone in Computers, which lists them as A does.
- **D · From the homes menu.** The homes chip's menu ends with "Pair a phone… 2 paired", for the window's home. One dialog pairs and lists the phones that open the home, each with Remove on hover. Computers stays as the Computers task built it.

## What it takes to build

Shared by all four:

1. **A code from the window.** Only `althar-host pair` makes one today: the host reads its network files for the origin and certificate and asks the home for an invitation (`IssueDevicePairing`). The home needs a call that answers the whole code, the token still made by the client and only its hash sent.
2. **This Mac reachable.** The desktop's own home serves no network API; only `althar-host` does (`networkApi.ts`). Pairing a phone with This Mac means the desktop runs that HTTPS/WSS listener itself, with a certificate it makes and keeps, on an address the phone reaches (Tailscale's name; the Wi-Fi address only at home), while the computer is awake. The largest piece.
3. **Who may make one.** `connectionAdmin` lets This Mac's window and an SSH window make codes, and refuses a desktop paired over HTTPS. Pairing a phone from a home you reach by pairing code needs that loosened, which is the person's call.
4. **Paired, and the list.** The window learns the code was used (a feed event, or a read of the invitation). `ListClientDevices` and `RevokeConnectionDevice` exist, but a device has no kind (a phone and a paired desktop are both `socket`) and no last seen: registration says what it is, and the home keeps when each was last connected.
5. **The print.** `starsOf`, `printDots` and `wordsOf` move from the phone's `geometry.ts` to a place both share, so both draw the same print.
6. **A QR encoder** in the kit (Nayuki's, MIT, ~600 lines).
7. **Optional: a shorter code.** The code carries the home's whole certificate, so its QR is dense: version 24, 113 modules square, for a P-256 certificate, and version 33, 149 square, for an RSA one. That scans from a 232 px tile, but near the edge. Without the certificate it is version 13, 69 square. Leaving the certificate out and having the phone fetch it and check it against the pin it carries (`Q`) is a protocol change on the host, the contracts and the phone.

Then each:

- **A** builds on the Computers task's section, so it lands after that one: a Phones group, a phone module and sheet, the panel in a sheet, a phones hook. Medium.
- **B** the same pieces, minus the module, plus a phones part in Computers' home sheet. A little less than A.
- **C** A's pieces, plus the popover's rows and pairing in place. The most, and the popover shuts on a click elsewhere, taking the code with it.
- **D** one menu item and one dialog, nothing in Computers, independent of the Computers task. The least.

## The pick

A. Phones sit beside the home's workers, added and opened out the way a worker is, in the one place that says what reaches this home. It holds the same for This Mac and studio, since Computers is the window's home. D's menu item is a cheap second way in, if a shortcut is wanted later.

## Screenshots

`shoot.mjs` shoots each direction in its states, the window only, at 1×, into `shots/` (git ignores it), with the lab running; `sheet.mjs` lays some side by side. Chromium can't start in an agent's sandbox on a Mac; run them outside:

```bash
node lab/phone-pairing/shoot.mjs        # or: shoot.mjs a-2 c-
node lab/phone-pairing/sheet.mjs name a-2 c-2
```

Delete the lab once a direction is picked to build, before building it.

## One QR for any phone (L, on by default)

The QR is a link, `https://althar.ai/pair#1.<code>`, rather than the bare
`althar-pairing1.<code>`. The code to paste is unchanged. A phone's own
camera opens it:

- With Althar installed, the phone opens it in the app (a universal link on
  iOS, an app link on Android), straight to pairing.
- Without Althar, the phone opens althar.ai/pair. The page reads the code
  after the `#` (which never reaches the site) and shows the home's print and
  words and the time left. It sends the phone to its store, then has an
  **Open in Althar** button (`althar://pair#…`), so nothing needs scanning
  again. O in the lab's bar opens that page with the window's code (I: iPhone
  or Android, X: ran out, E: no code, T: dark).

QR size: 117 squares across with the certificate (113 for the bare code), and
69 either way without it.

What building it takes:

- **Site (apps/site, Cloudflare Workers):** a static `/pair` page, and
  `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`.
  Route `/.well-known/*` through the Worker (`run_worker_first`), so they are
  served as `application/json` with no redirect.
- **Phone (althar-mobile):** the associated domain `applinks:althar.ai` and an
  Android intent filter (`autoVerify`) for `https://althar.ai/pair`. A route
  that takes the code from the link's `#` (Expo Router's `+native-intent`
  where it drops the fragment), for the `althar://` scheme too. The in-app
  scanner and paste field also accept the link form.
- **Contracts:** the pairing code parser accepts both forms.
  `althar-host pair` can print the link too.
- **Later, Android:** Google Play's install referrer could carry the code
  through the install, so the app opens on pairing without the page's button.
  iOS has no equivalent: there, the button is the way.
