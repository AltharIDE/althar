#!/bin/sh
# zypak sets Chromium's sandbox up inside the Flatpak's own; the base app carries it.
exec zypak-wrapper /app/main/althar "$@"
