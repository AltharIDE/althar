# Linux package follow-ups

> **Temporary.** Keep this note until the real-desktop checks below are done;
> then move any continuing support guidance to `DEVELOPMENT.md` and remove it.

The Linux package build and AppImage updater are covered by CI. The `.deb` and
`.rpm` still need later checks on real Debian- and RPM-based desktops:

- install, launch from the desktop menu, and confirm the application icon;
- sign in and confirm the token is kept by the desktop keyring;
- upgrade over an earlier package and remove the package cleanly.

These package-manager checks are not covered by the X11 smoke or the Flatpak
smoke. The current coverage table is in [DEVELOPMENT.md](../../DEVELOPMENT.md#reviewing-on-linux).
