#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/var/www/eluren"
REPO_URL="https://github.com/Zionxu645/wholesale-ordering-system.git"
SERVICE_FILE="/etc/systemd/system/eluren.service"
NGINX_FILE="/etc/nginx/sites-available/eluren"
ENV_DIR="/etc/eluren"
ENV_FILE="$ENV_DIR/eluren.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行此脚本。" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git gnupg nginx ufw

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(`.`)[0]' 2>/dev/null || echo 0)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /var/www
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

chown -R ubuntu:ubuntu "$APP_DIR"
sudo -u ubuntu bash -lc "cd '$APP_DIR' && npm ci --omit=dev"

mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
PORT=3000
NODE_ENV=production
TZ=Asia/Shanghai
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
ADMIN_PHONE=
ADMIN_PASSWORD=
ADMIN_NAME=管理员
PUBLIC_BASE_URL=https://eluren.cn
SUPABASE_IMAGE_BUCKET=product-images
CORS_ORIGINS=https://eluren.cn,https://www.eluren.cn
EOF
  chmod 600 "$ENV_FILE"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Eluren Wholesale Ordering System
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF

cat > "$NGINX_FILE" <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sfn "$NGINX_FILE" /etc/nginx/sites-enabled/eluren
nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl daemon-reload
systemctl enable eluren

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo
echo "基础环境安装完成。"
echo "下一步需要把 Render 中的环境变量填入：$ENV_FILE"
echo "环境变量未填写前，Eluren 服务不会启动。"
echo "Node: $(node -v)"
echo "npm: $(npm -v)"
echo "Nginx: $(nginx -v 2>&1)"
