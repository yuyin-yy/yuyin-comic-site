# 新手部署教程 · 这台 NAT 云服务器

> 针对 2026-11-07 购买的「流量型云服务器 A 型」，Ubuntu 22.04，2核2G/5M带宽/1000G流量。
> 全程只需要两条主线：**控制台网页点几下** + **SSH 命令复制粘贴**。

---

## 0. 你的服务器信息

| 项目 | 值 |
|---|---|
| 公网 IP | `103.236.89.123` |
| SSH 端口 | **43019**（不是 22！商家已把外部 43019 转发到机器内部的 22） |
| 登录用户 | `root` |
| 密码 | 控制台「登录信息」里那串（建议点「重置密码」换成自己的） |
| 系统 | Ubuntu 22.04 |

---

## 1. 先弄懂 3 个概念（1 分钟）

1. **NAT 转发**：这台机器的公网 IP 是多台服务器共用的，你没有独享的端口。外面要访问你的服务，必须先在控制台加一条转发规则：把「外部端口」的流量转发到你机器的「内部端口」。SSH 已经帮你转好了（外部 43019 → 内部 22）。
2. **内部端口 / 外部端口**：内部端口 = 你的程序实际监听的端口（我们的网站用 **3000**）；外部端口 = 控制台自动生成的、你访问时用的端口。
3. **安全组**：商家说了不要动，就永远不要碰那个页面。**3306（MySQL）绝对不要加转发**，数据库只允许服务器本机访问。

---

## 2. 控制台加 NAT 转发规则（1 分钟）

控制台 → **NAT转发** → 添加规则：

- 内部端口：`3000`，协议 TCP
- 外部端口：留空（自动生成）

**记下生成的外部端口**。本服务器已创建（2026-11-07）：名称 `Web`，外部端口 **46974** → 内部 3000。网站地址就是：

```
http://103.236.89.123:46974
```

---

## 3. 从你的电脑 SSH 连上服务器

Win10/11 自带 ssh，不用装软件。打开 **Git Bash**（装过 Git 就有）：

```bash
ssh root@103.236.89.123 -p 43019
```

- 第一次连会问 `Are you sure you want to continue connecting?` → 输入 `yes` 回车
- 出现 `password:` 时粘贴密码 —— **粘贴时屏幕上什么都不显示，是正常的**，粘完直接回车
- 看到 `root@xxx:~#` 提示符就是登录成功了

> 如果 `ssh-copy-id` 找不到命令，用这一行代替：
> ```bash
> cat ~/.ssh/id_ed25519.pub | ssh -p 43019 root@103.236.89.123 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
> ```

## 4. 配一次 SSH 免密（以后所有命令都不用输密码）

还是在你电脑的 Git Bash 里（没有密钥就先 `ssh-keygen -t ed25519`，一路回车）：

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub -p 43019 root@103.236.89.123
# 输最后一次服务器密码，之后验证：
ssh -p 43019 root@103.236.89.123 "echo ok"
# 直接输出 ok 而不要密码，就成功了
```

## 5. 服务器上装环境（Node 20 + pm2 + MySQL）

SSH 连着服务器的窗口里，整段复制粘贴：

```bash
apt update

# Node 20（NodeSource 源）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs mysql-server

# 备选：上面那条 curl 卡死/报错时，改用国内镜像装 Node 20：
# curl -fsSL https://registry.npmmirror.com/-/binary/node/v20.19.0/node-v20.19.0-linux-x64.tar.xz \
#   | tar -xJ -C /usr/local --strip-components=1

# pm2：守护 Node 进程，崩了自动拉起
npm i -g pm2

# npm 换国内源（后面装依赖快很多）
npm config set registry https://registry.npmmirror.com

# 验证：应分别显示 v20.x / mysql 版本 / pm2 版本
node -v && mysql --version && pm2 -v
```

## 6. 把代码发上去（本地一条命令）

在你电脑的 Git Bash 里：

```bash
cd "/d/OneDrive/桌面/余音的小破站AI版"

DEPLOY_HOST=103.236.89.123 DEPLOY_PORT=43019 DEPLOY_USER=root DEPLOY_PATH=/var/www/comic \
  bash deploy/deploy.sh
```

脚本会自动：打包（不含 node_modules 和 .env）→ 上传到服务器 `/var/www/comic` → 服务器上装依赖 → 用 pm2 启动。

结束后浏览器打开 `http://103.236.89.123:外部端口`，应该能看到网站首页（登录注册暂时报错，正常，数据库还没配）。

## 7. 服务器上配置 .env

回到 SSH 窗口：

```bash
cd /var/www/comic
cp .env.example .env

# 生成 JWT 密钥：复制下面命令输出的那串 64 位字符
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

nano .env
```

`nano .env` 里要改的三行：

```
JWT_SECRET=粘贴上面生成的 64 位字符串
DB_USER=comic
DB_PASSWORD=你自己定一个强密码（记牢，下一步建数据库账号要用同一个）
```

nano 操作：改完按 `Ctrl+O` 回车保存，`Ctrl+X` 退出。

## 8. 建库建表 + 应用账号

```bash
cd /var/www/comic

# 建库 yuyin_comic 和 users 表
mysql < deploy/users.sql

# 建 comic 账号（密码和 .env 里写的完全一致）
mysql -e "CREATE USER IF NOT EXISTS 'comic'@'localhost' IDENTIFIED BY '改成和.env一样的密码'; GRANT SELECT,INSERT,UPDATE ON yuyin_comic.* TO 'comic'@'localhost'; FLUSH PRIVILEGES;"
```

> root 直接敲 `mysql` 就能进，Ubuntu 的 root 走 socket 免密，不用输密码。

## 9. 重启并验证

```bash
cd /var/www/comic
pm2 restart comic --update-env
curl http://127.0.0.1:3000/api/health
```

看到 `{"success":true,"db":"up",...}` 就全部成功了。浏览器开 `http://103.236.89.123:外部端口`，注册一个账号试试。

开机自启（只做一次）：

```bash
pm2 save && pm2 startup
```

---

## 10. 用 DBeaver 管理服务器上的 MySQL（SSH 隧道，不开外网端口）

DBeaver → 新建连接 → MySQL：

- **常规页**：Server Host 填 `127.0.0.1`，Port `3306`，用户名 `comic`，密码、数据库 `yuyin_comic`
- **SSH 标签页**：勾选 Use SSH Tunnel；Host/IP `103.236.89.123`，Port `43019`，用户 `root`，密码 = 服务器密码
- 点「测试连接」，通过就能用了

> 原理：DBeaver 先 SSH 登录服务器，再从服务器内部连 127.0.0.1:3306。数据库从头到尾不暴露公网。

## 11. 以后更新网站怎么发

改完代码（或跑完 `python tools/build_data.py`），本地 Git Bash 一条命令：

```bash
cd "/d/OneDrive/桌面/余音的小破站AI版"
DEPLOY_HOST=103.236.89.123 DEPLOY_PORT=43019 DEPLOY_PATH=/var/www/comic bash deploy/deploy.sh
```

上传 + 装依赖 + 平滑重启一次完成。浏览器看旧内容就 `Ctrl+F5` 强刷。

## 12. 常见问题

| 现象 | 处理 |
|---|---|
| ssh 连不上 | 端口必须是 43019；控制台确认实例「运行中」；密码粘贴时屏幕不显示是正常的 |
| 网页打不开 | NAT 转发的外部端口是否记对；服务器上 `pm2 list` 看进程在不在 |
| 页面能开但登录报错 | `pm2 logs comic --lines 50`；多半是 .env 的 DB_PASSWORD 和数据库账号密码不一致 |
| npm 装依赖卡住 | 服务器已换 npmmirror 源的话重跑 deploy.sh 即可 |
| 磁盘/内存不对劲 | `df -h`、`free -h`；2G 内存 MySQL + Node 够用 |
| 重启服务器后网站没了 | `pm2 save && pm2 startup` 做过就没有；没做就补上再 `pm2 start deploy/ecosystem.config.js` |

## 13. 安全清单

- [ ] NAT 转发只加：22（商家已建）、3000。**永远不加 3306**
- [ ] 不碰「安全组」页面（商家要求）
- [ ] 不要在服务器上开 ufw / iptables，把自己 SSH 锁死就进不来了
- [ ] 控制台点「重置密码」换成自己的密码（截图里露过面的密码建议换掉）
- [ ] 每天备份数据库（可选，加进 crontab）：`mysqldump -ucomic -p yuyin_comic | gzip > /root/backup/comic-$(date +%F).sql.gz`
- [ ] 用 `IP:端口` 访问不需要备案；以后想绑域名，国内机房必须 ICP 备案

> 5Mbps 带宽说明：封面全量约 35MB，用户首次打开完整加载约 1 分钟，浏览器会缓存（封面缓存 7 天），第二次访问就快了，属正常现象。

---

## 附录：本机实际部署记录（2026-11-07 完成）

| 项目 | 实际值 |
|---|---|
| 网站地址 | `http://103.236.89.123:46974` |
| 代码目录 | `/var/www/comic` |
| pm2 进程名 | `comic` |
| 数据库 | `yuyin_comic` / 账号 `comic`（密码见服务器 `.env`） |
| 健康检查 | `curl http://127.0.0.1:3000/api/health` → `"db":"up"` |

额外做过的两件事（重装/换机要重做）：

1. 服务器镜像默认 `PubkeyAuthentication no`，已加 `/etc/ssh/sshd_config.d/99-pubkey.conf` 打开并 `systemctl restart ssh`；
2. 本地 Windows 用户名是中文，Git Bash 的 HOME 指向 `C:\ssh-home`（用户环境变量），SSH 密钥在那里。

### 功能与运维补充（2026-11-07 之后）

- **账号级追漫清单**：表 `favorites`（建表脚本 `deploy/favorites.sql`），接口 `GET /api/favs`、`POST /api/favs/sync`。应用账号需要 `GRANT DELETE ON yuyin_comic.favorites TO 'comic'@'localhost'`。登录时会把本地匿名清单自动并入账号并清空本地。
- **数据库账号分工**：程序用 `comic`（查/增/改 + favorites 的删）；人用 `dba`（仅 `yuyin_comic.*` 全权，DBeaver「管理」连接）。
- **安全**：fail2ban（sshd，5 次/10 分钟封 1 小时）、ufw 只放行 22/3000、Express 限速与安全头、登录错误统一文案。
- **备份**：`/root/backup/db-backup.sh`（`--single-transaction --no-tablespaces`，凭据 `/root/backup/.mysql-comic.cnf`），crontab 每日 3 点，保留 14 天。**注意不要把凭据放 `/root/.my.cnf`**，否则会顶掉 root 的 mysql 身份。
