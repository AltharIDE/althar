# flatpak-reach — Tasks

## 1. Spike: `flatpak-spawn --host` viselkedés

- [x] 1.1 Mérni a sandboxból: `flatpak-spawn --host` env/cwd/kilépőkód; kell-e host login shell a PATH-hoz; a `/run/user/1000/doc/<id>` (portál) és a `~/.var/app/…` (worktree/profil) út host-oldali elérhetősége és írhatósága; az eredmény a design.md-be; ellenőrzés: mérési jegyzet a design.md 3–4. döntésénél (mérve 2026-10-10, Flatpak 1.18.4: exit-kód és stdio átfut; a host session env jön, a sandbox env nem; `--directory` kell, `--clear-env` + explicit env; TERM átfut, KILL nem — `--watch-bus`; portal-azonosítók egyeznek, a profil/worktree út bitre ugyanaz)
- [x] 1.2 A mérés alapján a design.md 3–4. döntés véglegesítése (login shell vs explicit PATH, cwd-átadás, env-lista); ellenőrzés: a design.md frissült, és a 2.x taskok ennek megfelelnek (a döntések 3–4 mérési jegyzettel zárulnak; env = `--clear-env` + a device nevei + az executor explicit értékei)

## 2. Host-exec varrat

- [x] 2.1 A runtime agent-futtatása (`Installs`) `hostExec` seamet kap (locate/version/sign-in parancsok); seam nélkül a mai közvetlen út; ellenőrzés: unit teszt — seam nélkül közvetlenül spawnol, seam-mel a seamet hívja (`Installs.onDevice`; a seam nélküli út a meglévő tesztekkel; a `LaunchSpec.onDevice`-ot minden executor alkalmazza: process/signIn/signInFlow/version — process- és sign-in tesztek)
- [x] 2.2 Útvonal-fordítás a host-határon: `/run/flatpak/doc` → `/run/user/1000/doc` (arguments/cwd), csak a host-spawnnál; ellenőrzés: unit teszt a fordításra és az érintetlen útra (desktop `onDevice.test.ts`: portalPath + relayOut argumentumok/cwd; a profil-út érintetlen)
- [x] 2.3 A desktop runtime bekötése: `FLATPAK_ID` esetén `flatpak-spawn --host`, egyébként semmi; ellenőrzés: unit teszt a kapuzásra (flatpak → host, nem-flatpak → közvetlen) (`deviceHere({})` → undefined; Installs-teszt: onDevice-tal host-út, nélküle a mai út)
- [x] 2.4 Érthető hibaüzenet (`words.ts`), ha a host-elérés megtagadott; ellenőrzés: unit teszt az üzenetre (api.test.ts: `flatpak-spawn` / flatpak-hiba → „org.freedesktop.Flatpak" mondat)
- [x] 2.5 Az agent-sandbox beállítások adaptálása Flatpakban (`registry.ts`: Codex a device-en, Claude `allowUnsandboxedCommands` a reader szerepben), `FLATPAK_ID`-ra kapuzva, a kérések Altharhoz érkezése megtartva; ellenőrzés: unit teszt a kapuzásra + az 5.1 kézi végigjátszás Codexszel (a mért valóság: a beágyazott Codex-sandbox nem indul a Flatpakban, és a codex-acp egyik módja sem kérdez sandbox nélkül — ezért a Codex Flatpakban a személy saját, device-on telepített példányát futtatja `CODEX_PATH`/`codex-host.sh`-sal, `flatpak-spawn`-on át; reader-teszt: sandboxon kívül false, Flatpakban true; az ACP-initialize a hidon át mért)

## 3. Szerkesztők

- [x] 3.1 A szerkesztő-megnyitás (`editors`) Flatpakban a hoston indul (ugyanaz a seam); ellenőrzés: unit teszt a kapuzásra + kézi próba (editors.test.ts: host-find/start/portalPath; a lista a device-on talált szerkesztőket adja)

## 4. Manifest és engedélyek

- [x] 4.1 Finish-args: `--talk-name=org.freedesktop.Flatpak`, `--socket=ssh-auth`, indokló kommentekkel; host fájlrendszer továbbra sincs; ellenőrzés: manifest-review, minden engedély indokolt
- [x] 4.2 `flatpak-smoke.sh`: új engedély-ellenőrzések + host-elérés (ha a gépen van opencode) + a meglévők zölden; ellenőrzés: a smoke fut és zöld a friss builden (17/17 zöld: engedélyek, device-elérés, host opencode/codex, Codex-híd, a régi ellenőrzések)

## 5. Igazolás

- [ ] 5.1 Flatpak újraépítés; coordinator **OpenCode-dal** a hoston végigfut; Claude Code/Codex sandboxban fut, és a Codex parancsai is futnak; ellenőrzés: kézi végigjátszás eredménye (plan → task → worktree → agent, olvasó parancsokkal) — az újraépítés és a gépi igazolások megvannak (smoke, ACP-initialize a Codex-hidon át, host opencode fut), a GUI-végigjátszás hátravan
- [x] 5.2 Nem-flatpak regresszió: desktop `verify` (check + coverage + e2e) és runtime tesztek zöldek; AppImage/deb/rpm füstteszt változatlan; ellenőrzés: parancsok kimenete (`bun run verify` rc=0, minden csomag zöld; a desktop e2e 13 passed / 1 skipped — a valós agentes teszt szándékosan kihagyva)
- [x] 5.3 Git push ssh-agenten át Flatpakban (ahol van kulcs), vagy a korlát dokumentálása; ellenőrzés: mérési eredmény (a socket megvan és elérhető; a friss sandbox-home miatt `known_hosts` nincs → a hostkulcs-ellenőrzésnél megáll; a host agentben itt nem volt kulcs; a tokenes út marad az alap — ADR-017)

## 6. Dokumentáció és zárás

- [x] 6.1 ADR + `DEVELOPMENT.md`/README: a sandbox határai (mit ér el és mit nem), engedélyek indoklása, profil-szétválás (CLI ↔ Flatpak), ssh vs token; ellenőrzés: a bekezdések megvannak (ADR-017 + `apps/desktop/README.md` „The Flatpak" szakasz)
- [x] 6.2 `openspec validate flatpak-reach --strict` zöld; ellenőrzés: a parancs sikeres („Change 'flatpak-reach' is valid")
