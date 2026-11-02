# 部署备忘 · 余音的小破站

> 站点构成：`server.js`（Express，托管静态 + 登录接口）+ `public/`（35MB，含 590 张本地封面）+ 可选 MySQL。
> 只要 Node ≥ 18 就能跑，**不装数据库也能正常浏览**（只有登录/注册不可用）。

| 文件 | 用途 |
|---|---|
| `Dockerfile` / `docker-compose.yml` | 容器化部署，连 MySQL 一起跑 |
| `deploy/ecosystem.config.js` | 裸机 PM2 进程配置 |
| `deploy/deploy.sh` | 一键上传 + 装依赖 + 重启 |
| `deploy/Caddyfile` / `deploy/nginx.conf` | 反向代理 + HTTPS |
| `deploy/users.sql` | 建库建表 |
| `.env.example` | 环境变量模板 |

---

## 1. 买机器

| 选择 | 参考价（2026-10） | 备案 | 说明 |
|---|---|---|---|
| 阿里云香港轻量 2核2G/40G/30Mbps/1TB | 34 元/月，408 元/年 | **免备案** | 推荐，国内 30–60ms |
| 阿里云香港轻量 2核1G/1024GB | 24 元/月 | 免备案 | 也能跑，内存没余量 |
| 腾讯云国内轻量 2核2G/3M/200GB | 45 元/月（新用户 68 元/年） | 需 ICP 备案 | 国内最快，但漫画索引站备案难过 |

- 系统选 **Ubuntu 22.04 / 24.04**；
- 防火墙（安全组）先开 **22、80、443**，调试阶段可临时开 3000；
- 香港/海外机器**不需要备案**，域名解析过去即可。

## 2. 方式 A：Docker Compose（推荐，最省事）

```bash
# 服务器上装 Docker
curl -fsSL https://get.docker.com | sh

# 上传项目（本地执行，Windows 用 Git Bash）
cd /d/OneDrive/桌面/漫画网站
tar czf comic.tgz --exclude node_modules --exclude backup --exclude .tmp \
  --exclude data --exclude tools server.js package.json package-lock.json public deploy \
  Dockerfile docker-compose.yml .env.example
scp comic.tgz root@你的IP:/root/

# 服务器上
cd /root && mkdir -p /opt/comic && tar xzf comic.tgz -C /opt/comic && cd /opt/comic
cp .env.example .env
nano .env        # 必改 JWT_SECRET 与 DB_PASSWORD / DB_ROOT_PASSWORD
docker compose up -d --build
docker compose logs -f app     # 看到「数据库连接正常」即可 Ctrl+C
```

验证：`curl http://你的IP:3000/api/health` → `{"success":true,"db":"up",...}`

> 生成 `JWT_SECRET`：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 3. 方式 B：裸机 + PM2（不装 Docker）

```bash
# 1) Node 20 + pm2 + MySQL
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs mysql-server
sudo npm i -g pm2

# 2) 建库建表 + 建应用账号
sudo mysql < deploy/users.sql
sudo mysql -e "CREATE USER IF NOT EXISTS 'comic'@'localhost' IDENTIFIED BY '你的密码';
               GRANT SELECT,INSERT,UPDATE ON yuyin_comic.* TO 'comic'@'localhost'; FLUSH PRIVILEGES;"

# 3) 配置环境变量
cp .env.example .env && nano .env    # DB_HOST=127.0.0.1，填 DB_USER/DB_PASSWORD

# 4) 启动
mkdir -p logs
pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup
```

以后改完页面/数据，本地执行一条命令即可发布：

```bash
DEPLOY_HOST=你的IP DEPLOY_USER=root DEPLOY_PATH=/var/www/comic bash deploy/deploy.sh
```

## 4. 域名 + HTTPS

**Caddy（推荐，自动证书）**

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # 把 comic.example.com 换成你的域名
sudo systemctl reload caddy
```

**Nginx（想用 certbot 就选这个）**

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/comic.conf
sudo ln -s /etc/nginx/sites-available/comic.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 你的域名
```

DNS 记得加一条 A 记录指向服务器 IP；走 HTTPS 后把 `.env` 里的
`CORS_ORIGIN=https://你的域名` 填上并重启（`pm2 restart comic --update-env`）。

## 5. 日常更新

```bash
# 改了漫画数据（tools/build_data.py 会重写 public/js/data.js）
python tools/build_data.py
bash deploy/deploy.sh          # 传上去并重启

# 只改了 HTML/CSS/JS 也一样，deploy.sh 每次都整包上传（35MB，几秒钟）
```

浏览器看到旧数据时按 `Ctrl+F5` 强刷；`data.js` 服务端只缓存 1 小时，封面缓存 7 天。

## 6. 运维三件事

```bash
# 看日志
docker compose logs -f app            # Docker
pm2 logs comic --lines 100            # PM2

# 备份数据库（建议加进 crontab，每天 3 点）
mysqldump -ucomic -p yuyin_comic | gzip > /root/backup/comic-$(date +%F).sql.gz

# 看资源占用
docker stats / pm2 monit / free -h / df -h
```

站点是静态为主，2核2G 足够；如果哪天内存吃紧，先看 `free -h` 里的 MySQL。

## 7. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 502 Bad Gateway | Node 没起来：`pm2 logs comic` / `docker compose logs app`，多半是 3000 端口被占或 `.env` 写错 |
| 登录提示「数据库不可用」 | `.env` 里 `DB_HOST/DB_USER/DB_PASSWORD` 不对；容器部署时 `DB_HOST` 必须是 `db` |
| 页面能开但封面 404 | `public/imgs/covers2` 没传上去（打包时别漏 `public`）；确认 `data.js` 里路径是 `imgs/covers2/xxx.webp` |
| 改了数据前台没变 | 浏览器缓存，`Ctrl+F5`；或 `data.js` 被反代缓存了，检查 Caddy/Nginx 的缓存规则 |
| Docker 里没自动建表 | 数据卷已存在时初始化脚本不会重跑：`docker compose exec -T db mysql -uroot -p < deploy/users.sql` |
| 容器时间差 8 小时 | `docker-compose.yml` 里给 app 加 `TZ: Asia/Shanghai` |
| 磁盘满 | 封面 35MB + MySQL 几十 MB，40G 盘不会满；先看 `/var/log`、`docker system df` |

## 8. 别忘了

- `.env`、`sql.env` 永远不要提交或打包上传（`.dockerignore`、`.gitignore` 已排除）；
- 站点性质是「漫画元数据索引 + 外链阅读」，页面底部已声明不存储漫画内容，保留这段声明；
- 抓取补数据要在**服务器**上跑（独立 IP），仍然要温和：单线程、间隔 3–4 秒、每批 ≤80、遇 403 立即停。
