#!/bin/sh
set -eu

# Fly volumes are attached as root-owned filesystems. Give the unprivileged
# application user access before dropping privileges for the Umbraco process.
chown -R "$APP_UID:$APP_UID" /data

exec gosu "$APP_UID:$APP_UID" dotnet OlavurEllefsen.Umbraco.dll
