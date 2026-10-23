#!/bin/sh
# kmd 팀 서버 설치 — sudo sh kmd-install.sh --team --url http://kmd.team.local [--root /srv/kmd] [--gitlab-group team --gitlab-api https://gitlab.team.local]
# 깔고 늘 켜(systemd) 첫 설정 주소를 찍는다. GitLab 열쇠는 숨김 입력으로만 묻는다(인자 · 셸 기록에 남지 않게).
set -eu
URL=""; ROOT="/srv/kmd"; GROUP=""; API=""; PORT=7373
while [ $# -gt 0 ]; do
  case "$1" in
    --team) ;;
    --url) URL="$2"; shift ;;
    --root) ROOT="$2"; shift ;;
    --gitlab-group) GROUP="$2"; shift ;;
    --gitlab-api) API="$2"; shift ;;
    --port) PORT="$2"; shift ;;
  esac
  shift
done
command -v node >/dev/null 2>&1 || { echo "node 22 가 없다 — 먼저 깐다"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git 이 없다 — 먼저 깐다"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/kmd
id kmd >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin kmd
mkdir -p "$APP" "$ROOT/.kmd"
cp -R "$HERE"/. "$APP"/
if [ -n "$GROUP" ]; then
  printf '{\n "gitlab": { "api": "%s", "group": "%s" }\n}\n' "$API" "$GROUP" > "$ROOT/.kmd/serve.json"
  printf 'GitLab 그룹 %s 의 백업 열쇠(입력이 보이지 않는다): ' "$GROUP"
  stty -echo; read -r TOKEN; stty echo; echo
  printf '%s' "$TOKEN" | node "$APP/server/bin/kmd.mjs" secret set gitlab --root "$ROOT" --stdin >/dev/null
  echo "✓ 백업 열쇠를 넣었다 — 지우기 권한이 없는 열쇠여야 한다"
fi
chown -R kmd "$ROOT"
cat > /etc/systemd/system/kmd.service <<EOF
[Unit]
Description=kmd 팀 서버
After=network.target
[Service]
User=kmd
ExecStart=$(command -v node) $APP/server/bin/kmd.mjs serve $ROOT --host 0.0.0.0 --port $PORT
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now kmd >/dev/null
sleep 2
CODE=$(journalctl -u kmd -n 50 --no-pager | grep -o 'setup#code=[^ ]*' | tail -1 | cut -d= -f2)
echo "✓ 깔았다 — 브라우저에서 이 주소를 열면 첫 설정(한 번만): ${URL:-http://$(hostname):$PORT}/setup#code=$CODE"
