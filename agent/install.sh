#!/usr/bin/env bash
# Installs Glances as a per-user service that serves stats to the hardware dashboard desklet.
#
#   agent/install.sh --bind 127.0.0.1                            # stats for this computer only
#   agent/install.sh --bind 100.64.0.5 --config hosts/server.conf  # a server, on its private VPN address
#
# No sudo: it is a user service, kept running after logout with "loginctl enable-linger".
set -euo pipefail

readonly GLANCES_VERSION="4.5.9"
readonly NVIDIA_ML_VERSION="13.615.71"
readonly PORT=61208
readonly UNIT_NAME="glances-dashboard.service"
readonly DISABLED_PLUGINS="ports,wifi,folders,containers,ip,diskio"
readonly STARTUP_WAIT_SECONDS=30

agent_dir="$(cd "$(dirname "$0")" && pwd)"
bind_address=""
config_file="$agent_dir/glances.conf"

while [ $# -gt 0 ]; do
    case "$1" in
        --bind) bind_address="$2"; shift 2 ;;
        --config) config_file="$(realpath "$2")"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done
if [ -z "$bind_address" ]; then
    echo "usage: $0 --bind ADDRESS [--config FILE]" >&2
    exit 2
fi
if [ ! -f "$config_file" ]; then
    echo "config not found: $config_file" >&2
    exit 1
fi

python3 -m venv "$agent_dir/.venv"
"$agent_dir/.venv/bin/pip" install --quiet "glances[web]==$GLANCES_VERSION"
if command -v nvidia-smi >/dev/null 2>&1; then
    "$agent_dir/.venv/bin/pip" install --quiet "nvidia-ml-py==$NVIDIA_ML_VERSION"
fi

# The unit names this machine's address, so it is generated here and kept out of git.
unit_file="$agent_dir/$UNIT_NAME"
cat > "$unit_file" <<UNIT
[Unit]
Description=Glances stats for the hardware dashboard desklet
After=network-online.target

[Service]
ExecStart=$agent_dir/.venv/bin/glances --webserver --disable-webui --disable-check-update --disable-plugin $DISABLED_PLUGINS --bind $bind_address --port $PORT --time 2 --config $config_file
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
UNIT

loginctl enable-linger "$USER"
systemctl --user enable "$unit_file"
systemctl --user daemon-reload
systemctl --user restart "$UNIT_NAME"

url="http://$bind_address:$PORT/api/4/system"
for _ in $(seq "$STARTUP_WAIT_SECONDS"); do
    if python3 -c "import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=2)" "$url" 2>/dev/null; then
        echo "Glances is answering on http://$bind_address:$PORT"
        exit 0
    fi
    sleep 1
done
echo "Glances did not answer on $url; see: journalctl --user -u $UNIT_NAME" >&2
exit 1
