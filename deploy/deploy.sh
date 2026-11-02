#!/usr/bin/env bash
# ================================================================
# 一键发布：把站点打包传到服务器，装依赖并重启 PM2
# ----------------------------------------------------------------
# 用法（在项目根目录执行，Windows 用 Git Bash）：
#   DEPLOY_HOST=1.2.3.4 DEPLOY_USER=root DEPLOY_PATH=/var/www/comic bash deploy/deploy.sh
# 或者：
#   bash deploy/deploy.sh 1.2.3.4
#
# 前置条件：
#   1. 服务器已装 Node ≥18、pm2（npm i -g pm2）、已建好 /var/www/comic 与其中的 .env
#   2. 本机 ssh 已能免密登录（把公钥贴到服务器的 ~/.ssh/authorized_keys）
#
# 只传运行必需的文件：server.js / package*.json / public / deploy
# 配置类文件（.env、sql.env）不会上传，避免覆盖服务器上的口令
# ================================================================
set -euo pipefail

HOST="${1:-${DEPLOY_HOST:-}}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_PORT="${DEPLOY_PORT:-22}"
REMOTE_DIR="${DEPLOY_PATH:-/var/www/comic}"

if [ -z "$HOST" ]; then
  cat <<'EOF'
用法：
  DEPLOY_HOST=服务器IP DEPLOY_USER=root DEPLOY_PATH=/var/www/comic bash deploy/deploy.sh
  bash deploy/deploy.sh 服务器IP

可覆盖的环境变量：
  DEPLOY_USER   登录用户，默认 root
  DEPLOY_PORT   SSH 端口，默认 22
  DEPLOY_PATH   远端目录，默认 /var/www/comic
EOF
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 组装要上传的清单（package-lock.json 缺失时自动跳过）
FILES=(server.js package.json public)
# 用 if 而不是「[ ... ] && ...」：后者在条件为假时返回非 0，
# 配合 set -e 会让脚本静默退出
if [ -f package-lock.json ]; then FILES+=(package-lock.json); fi
if [ -d deploy ]; then FILES+=(deploy); fi
# 模板一起带上（不会覆盖服务器上已有的 .env）
if [ -f .env.example ]; then FILES+=(.env.example); fi

echo "==> 1/3 打包并上传到 ${REMOTE_USER}@${HOST}:${REMOTE_DIR}"
tar czf - \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  "${FILES[@]}" \
  | ssh -p "$REMOTE_PORT" "${REMOTE_USER}@${HOST}" \
      "mkdir -p '${REMOTE_DIR}' && tar xzf - -C '${REMOTE_DIR}'"

echo "==> 2/3 远端安装依赖"
ssh -p "$REMOTE_PORT" "${REMOTE_USER}@${HOST}" \
  "cd '${REMOTE_DIR}' && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi"

echo "==> 3/3 重启服务"
ssh -p "$REMOTE_PORT" "${REMOTE_USER}@${HOST}" "
  cd '${REMOTE_DIR}'
  if [ ! -f .env ]; then
    echo '  ! 远端没有 .env，登录接口会连不上数据库（静态站点不受影响）'
    echo '    执行：cp .env.example .env 然后改 DB_PASSWORD 与 JWT_SECRET'
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    echo '  ! 没装 pm2，请先执行：npm i -g pm2'
    exit 1
  fi
  mkdir -p logs
  if pm2 describe comic >/dev/null 2>&1; then
    pm2 restart comic --update-env
  else
    pm2 start deploy/ecosystem.config.js
    pm2 save
  fi
  pm2 list | sed -n '1,12p'
"

echo
echo "完成。检查一下："
echo "  curl -s http://${HOST}:3000/api/health"
echo "  （如已挂 Caddy/Nginx，改用你的域名访问）"
