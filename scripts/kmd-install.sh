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
# 다시 돌리기(새 판) — 앞 판의 코드 폴더를 걷고 새로 둔다(지식 · 살림 자리는 그대로)
mkdir -p "$APP" "$ROOT/.kmd/dl"
rm -rf "$APP/app" "$APP/core" "$APP/server" "$APP/agent" "$APP/docs" "$APP/node_modules"
cp -R "$HERE"/. "$APP"/
# PC 꾸러미 — 팀 꾸러미 안(또는 옆)의 kmd-<판>-pc.zip 을 받기 자리에. 설치 한 줄이 여기서 받아 PC 에 깐다
for Z in "$HERE"/kmd-*-pc.zip "$HERE"/../kmd-*-pc.zip; do if [ -f "$Z" ]; then cp "$Z" "$ROOT/.kmd/dl/"; fi; done
rm -f "$APP"/kmd-*-pc.zip
ls "$ROOT/.kmd/dl"/kmd-*-pc.zip >/dev/null 2>&1 && echo "✓ PC 꾸러미를 받기 자리에 두었다 — 설치 한 줄이 받아 간다" || echo "· PC 꾸러미가 없다 — kmd-<판>-pc.zip 을 $ROOT/.kmd/dl 에 두면 설치 한 줄이 받아 간다"
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
# 셸 명령 — 어느 사용자로 쳐도 kmd 사용자로 · 이 지식 폴더로 돈다(관리자 설명서의 셸 표)
NODE=$(command -v node)
cat > /usr/local/bin/kmd <<WRAP
#!/bin/sh
# kmd 팀 서버의 셸 명령 — kmd 사용자로 · 지식 폴더 $ROOT
[ "\$(id -un)" = kmd ] && exec $NODE $APP/server/bin/kmd.mjs "\$@" --root $ROOT
exec sudo -u kmd $NODE $APP/server/bin/kmd.mjs "\$@" --root $ROOT
WRAP
chmod 755 /usr/local/bin/kmd
systemctl daemon-reload
systemctl enable kmd >/dev/null
# 처음이면 켜고, 다시 돌리면(새 판) 새 코드로 다시 켠다
systemctl restart kmd
sleep 2
CODE=$(journalctl -u kmd -n 50 --no-pager | grep -o 'setup#code=[^ ]*' | tail -1 | cut -d= -f2)
if [ -n "$CODE" ]; then echo "✓ 깔았다 — 브라우저에서 이 주소를 열면 첫 설정(한 번만): ${URL:-http://$(hostname):$PORT}/setup#code=$CODE"
else echo "✓ 깔고 다시 켰다 — $("$NODE" "$APP/server/bin/kmd.mjs" --version) · 셸 명령은 kmd(예: kmd user)"; fi
