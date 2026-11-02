# 项目长期约定 · 余音的小破站

## 技术栈
- 静态前端（无框架、无 jQuery/Bootstrap）+ Express 4 + MySQL(users 表) + JWT + bcryptjs。
- 启动：`npm start` → http://localhost:3000 （同时托管静态站点与 /api/*）。

## 前端目录（v4，七页 + 分层）
```
public/
├─ css/
│  ├─ base.css         设计变量 + 重置 + 容器/工具类
│  ├─ layout.css       导航（无下拉菜单）、移动抽屉、页脚（两栏：说明 + 联系声明）
│  ├─ components.css   按钮、区块标题、卡片、榜单面板、站娘、Toast、进场动画
│  ├─ pages.css        首页 Hero/两栏、详情页、登录页（唱片）、我的追漫
│  ├─ filter.css       分类页：暗色页头 + 五行筛选卡片 + 分页
│  ├─ rank.css         排行榜：三栏（冠军海报/榜单表/题材与说明）
│  ├─ updates.css      最近更新：3 秒轮播 + 本周热门 + 季度内列表 + 更早卡片墙
│  └─ responsive.css   断点 1180 / 1080 / 900 / 720 / 460（+359）
├─ js/
│  ├─ core.js          命名空间 YY：DOM/转义/参数/收藏/登录态/Toast/图标/fmtHeat
│  ├─ data.js          全部作品数据（由 tools/build_data.py 生成，勿手改）
│  ├─ ui/nav.js        导航 + 搜索联想 + 随机一部 + 抽屉 + 登录态
│  ├─ ui/footer.js     页脚（站点说明 + 联系声明，不放分类/题材链接）
│  ├─ ui/card.js       卡片/网格/榜单/追漫按钮/滚动进场
│  ├─ ui/mascot.js     左下角站娘：表情按钮收起弹出、打字机气泡、台词池
│  ├─ pages/*.js       home / category / rank / updates / detail / auth / my
│  └─ app.js           按 body[data-page] 分发，加载公共组件
└─ index.html / category.html / rank.html / updates.html / index02.html / Login.html / my.html
```
- 导航顺序：首页 / 分类 / 排行榜 / 最近更新 / 我的追漫（「全部漫画」页已删除，由分类页取代）。

## 模块约定
- 依赖方向：`pages/* → ui/* → core.js`，反向不引用；跨模块只通过 `window.YY`。
- 新增页面：建 `pages/xxx.js` 并在 `app.js` 的 `ROUTES` 登记，`body[data-page]` 与之一致。
- 脚本按顺序引入：data.js → core.js → ui/* → pages/该页 → app.js；不用 ES module（兼容 file://）。
- 样式只进对应层的 css 文件，禁止页面内联 `<style>`；颜色一律用 base.css 的变量。
- 复用类名要带页面前缀（`.rank-tabs` 而非 `.tabs`）——登录页已有 `.tabs`，曾导致背景冲突。

## 数据字段（data.js 每条）
id/title/author/cover/tags/region/audience/rating/status/chapter/chapterNo/total/heat/
updated/desc/**hasChs**/**pending**/readUrl/detailUrl/srcId/chs
- `chs`：`[[章节id, "第N话 标题", "日期"], …]`，新话在前，最多 16 条；链接由 `readUrl` 换 id 得到。
- `hasChs=1` 表示能直达原站章节；`0` 表示详情没抓到（`pending=1`）。
  **pending 的条目一律不给外链**：阅读入口与章节空态都跳 `404.html?from=pending&id&t`，
  该页会显示「《标题》的内容还没抓到」并给出回作品页的出口。
- `rating=0` 表示源站无评分 —— UI 隐藏角标、详情页显示「—」，不要填假分数。

## 数据管线（tools/，源站 guazimanhua.com）
- `scrape_guazi.py`：列表页收集候选（city/audience/is_end/sort=hits 多入口合并，带 region/受众标签）
  → 详情页解析 `<script type=application/ld+json>` + `all-chapter-grid`（完整章节 id）
  → 封面下载 → 汇总 `data/guazi_comics.json`。参数：`--list / --detail N / --cover N / --build / --all N`。
  注意：它的 `fetch()` 走 urllib，**详情页必被 403**，只适合翻列表页。
- `scrape_scrapling.py`：**当前唯一在用的详情补抓脚本**（Scrapling 0.5 / curl_cffi 指纹伪装）。
  单会话复用 + 1.8~3.2s 抖动间隔 + 每 35 个长休 20~30s + 403/429 分级冷却（90/240/480/900s）
  + 断点续跑（跳过已有 `.tmp/gz/details/<id>.json`）+ 失败留痕 `.tmp/gz/failed_ids.json`。
  实测一轮 26 分钟补 397 部，仅触发 1 次（误判）风控。风控判定只看 `<title>`，别用正文关键词。
  用法：`python tools/scrape_scrapling.py --all`（`--stealth` 为浏览器兜底，慢 10 倍）。
- `guazi_loop.py`：**已弃用**（依赖会被 403 的 urllib 链路），保留作历史参考。
- `build_data.py`：`data/guazi_comics.json` → `public/js/data.js`（编号、chapterNo、hasChs、pending、排序）。
- `compress_covers.py`：封面转 webp(320w,q82)，约 25KB/张；需系统 Python（D:\Python39 有 Pillow）。
- 旧数据快照：`data/legacy_manhua3.json`（200 部，来自 manhua3，链接多已失效）。
- manhua3 那套脚本（scrape_manhua3/scan_cache/localize_covers）保留但不再使用。
- 现状（2026-11-01）：590 部全部有详情/简介/评分/章节，data.js 约 1.0MB（gzip 后 255KB，
  反代已有 encode gzip / zstd）。遗留缺口：124 部 `region` 为空（来自 sort=hits 入口，列表页未带地区），
  补法是把 LIST_TASKS 的 city 分类翻页跑全再按 id 覆盖，约 100 个列表请求。

## 其他约定
- 收藏键 `yy-favs`、登录令牌 `yy-token`、站娘状态 `yy-mascot`（迁移键 `yy-mascot-v2`）。
- 密钥/DB 口令只放 `sql.env` 或环境变量，已进 .gitignore；生产必须覆盖 JWT_SECRET。
- 旧版源码归档在 `backup/`；大改前先备份。

## 视觉基线
纸感背景 #f5f3ef、墨黑 #14161c、强调红 #e5323f；卡片圆角 16px、封面 3:4；
系统字体栈（PingFang SC / Microsoft YaHei）。

## 部署（deploy/ + 根目录）
- 运行面：`server.js` 静态托管 `public/`（35MB）+ `/api/{register,login,me,health}`；
  没有数据库时静态站点照常，`/api` 返回 503。
- 配置文件：`Dockerfile` / `docker-compose.yml`（app + mysql8，首启自动灌 `deploy/users.sql`）
  / `.dockerignore` / `.env.example`（JWT_SECRET、DB_*、CORS_ORIGIN）。
- `deploy/`：`ecosystem.config.js`（PM2，cwd 指向项目根）、`deploy.sh`（tar over ssh 上传 +
  远端 npm ci + pm2 重启，不传 .env）、`Caddyfile` / `nginx.conf`（反代 + /imgs 7 天缓存）、
  `users.sql`（users 表）。
- 推荐：阿里云香港轻量 2核2G/30Mbps（免备案）；国内机房需 ICP 备案。
- 部署说明见根目录 `DEPLOY.md`（含备份、排错表、更新流程）。

## Git 与 CI（2026-11-02 起）
- 仓库已 `git init`（`main` 分支），首个提交含 904 文件 / 32MB；提交身份只设在本仓库。
- `.gitattributes`：封面标 binary，`* text=auto`（仓库里存 LF，服务器 checkout 也是 LF）。
- `.github/workflows/deploy.yml`：push main → rsync（`--delete` + 保护性 exclude）→ `npm ci`
  → `pm2 reload`。未配 Secrets 时 guard 步骤跳过部署而不报错。
- **改 rsync 参数必须保留** `--exclude '.env' '.env*' 'sql.env' 'node_modules' '.tmp' 'logs'`，
  它们同时是 `--delete` 的保护名单，删掉会清空服务器上的生产环境变量。
- 远端仓库需用户自己建（GitHub 连接器只有只读权限，代建会 403）。详见 `DEPLOY.md` 第 9 节。
