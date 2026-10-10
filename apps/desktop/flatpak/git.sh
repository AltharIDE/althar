#!/bin/sh
# The Platform runtime has no git of its own: the SDK's is carried in beside
# the app, with its helpers and templates where it can find them.
GIT_EXEC_PATH=/app/libexec/git-core GIT_TEMPLATE_DIR=/app/share/git-core/templates exec /app/libexec/althar/git "$@"
