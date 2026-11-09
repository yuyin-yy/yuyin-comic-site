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
│  ├─ orb.css          封面球：舞台/卡片/标题/提示条（含自己的断点）
│  └─ responsive.css   断点 1180 / 1080 / 900 / 720 / 460（+359）
├─ js/
│  ├─ core.js          命名空间 YY：DOM/转义/参数/收藏/登录态/Toast/图标/fmtHeat
│  ├─ data.js          全部作品数据（由 tools/build_data.py 生成，勿手改）
│  ├─ ui/nav.js        导航 + 搜索联想 + 随机一部 + 抽屉 + 登录态
│  ├─ ui/footer.js     页脚（站点说明 + 联系声明，不放分类/题材链接）
│  ├─ ui/card.js       卡片/网格/榜单/追漫按钮/滚动进场
│  ├─ ui/orb.js        首页「最近更新」封面球（拖动旋转 / 滚轮摊平成网格）
│  ├─ ui/tilt.js       详情页「主封面」：3D 倾斜 + 跟随光泽（银框）
│  ├─ ui/mascot.js     左下角站娘：表情按钮收起弹出、打字机气泡、台词池
│  ├─ pages/*.js       home / category / rank / updates / detail / auth / my
│  └─ app.js           按 body[data-page] 分发，加载公共组件
└─ index.html / category.html / rank.html / updates.html / index02.html / Login.html / my.html
```
- 导航顺序：首页 / 分类 / 排行榜 / 最近更新 / **罗生门** / 我的追漫（「全部漫画」页已删除，由分类页取代）。
- 详情页**左侧主封面**（`.detail-cover`）是银框 + 3D 倾斜：`ui/tilt.js` 写 `--gx/--gy`
  与 transform，样式在同名规则（`pages.css` 详情页段）。银框由 `padding: var(--frame)` +
  金属渐变背景撑出来，`--frame` 桌面 10 / ≤900 8 / ≤720 6。
  底部「相关推荐」卡片保持原样（之前误加在这批 `.card` 上，已撤）。
- 首页底部「最近更新」是一颗封面球（`YY.orb`）：拖动旋转，滚轮或标题右侧的分段按钮摊平成网格；
  平铺只铺 4 行（窄屏 6 行），多出来的封面原地淡出。调球体看 `js/ui/orb.js` 顶部常量与 `layout()`。

## 罗生门模块（public/gate/，2026-11-08）
独立成块，不按分层拆：`index.html` + `gate.css` + `gate.js` + `gate-fx.js` + `img/`（1440 / 800 两档）。
不引 nav/footer/core.js，只读 `window.COMICS`；落地跳 `../index02.html?id=`。
- 页面是整屏插画 + 一扇门：门页 = 同一张底图裁下门那块，`background-position`
  必须减**整图在视口里的原点**（不是门的坐标），否则窄屏整块错位。
- 门框比例常量在 `gate.js` 顶部 `DOOR`（原图 1600×1000 上量：704,365→908,778）。
- 无站内导航，只有一个「返回站点」；顶部 `.gate-top` 的点击不参与推门。
- 导航 6 项后在 1081~1140 会挤，`responsive.css` 开头用 1140 提前收抽屉。

### 光尘层 gate-fx.js（Canvas 2D，桌面 532 / 手机 300 颗）
`<canvas class="gate-fx">` 放在 `.gate-world` 里门之后（跟推镜一起缩放），
`pointer-events:none`。`GateFx.setDoor(门矩形)` / `GateFx.burst()` 由 `gate.js` 调，
另有 `GateFx.debug(k)` 吐某层每颗坐标用于核对。九类粒子：
1 天空浮尘 / 2 水面碎光 / 3 门缝光尘 / 4 大虚焦光斑 / 5 水面波纹 / 6 门框柔光 /
7 水面波光带 / 8 天空流雾 / 9 绕门丝带。
- **必须分两遍画**：柔光（4/5/6/7/8）用 `lighter`，实点（1/2/3/9）用 `source-over`。
  全用加光时金色会被顶成纯白，白点落在白门板/浅蓝天上等于隐形。
- 贴图三套：`dot`（实心核大，小点用）/ `halo`（柔，大光斑用）/
  `orb`（亮核 + 淡暗边 0.34，环绕珠用）。64px 渐变缩到 2px 会稀释 alpha。
- **环绕丝带**：一条 22 颗共享角度和呼吸相位（各闪会把弧切碎），外圈 7 条均匀铺开、
  rad 收拢在 0.9~1.04（散开就露缺口），内流 3 条从 rad 0.3 螺旋吸入。
  轨道横向 1 门宽、纵向 0.72 门高 —— 门瘦长，纵向半径小于半门高就全压在门板上。
  珠子要「间距 < 可见直径（约 0.6 倍设定值）」才连成弧；桌面 11~15px、手机 6.5~9px。
- 速度单位是 **px/秒**，写每帧 0.05px 等于每秒 3px（看着像没动）。
  另有全局气流 `skyWind()` / `waterFlow()` 给所有粒子共享，整片空气才「在动」。
- 水面高度按门反推（`door.y - door.h*0.05`），不要写 `H*0.4`：cover 裁切时比例会变。
- 手机 `lite = 掉帧 || W <= 720`；掉帧兜底：头 45 帧平均 >26ms 降 DPR 到 1 并减粒子。
  `prefers-reduced-motion` 下 CSS `display:none` + 脚本不启动。
- **`sizeCanvas` 不能只信 `canvas.clientWidth`**：CSS 未生效时它返回内在宽度 300
  （不是 0），`|| innerWidth` 兜底救不到，画布会按 300×150 建起来再被拉伸。
  小于视口九成一律不认。`setDoor` 可能比本文件先跑（`window.GateFx` 还没定义），
  所以要有 `hasDoorParts` 补建 + dispatch resize 兜底。



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
- `shot.js`：**本地截图/验收工具**，连 CDP 用 `Emulation.setDeviceMetricsOverride`
  钉死视口再截（无头 Chrome 的 `--window-size` 与实际视口差 150px 左右，会看错版式）。
  `node tools/shot.js --url … --w 1440 --h 900 --out .tmp/a.png`；
  另有 `--touch`（DPR2 手机）/`--click`/`--eval`/`--wait`/`--probe`/
  `--shots N --gap ms`（同一次加载连拍，做帧间差分）/`--reduce`（模拟减少动效）。
  **三个会骗人的默认行为，别再踩**：
  1. CDP 新建的标签是后台页，rAF 与 CSS 过渡全暂停 —— 必须 `Page.bringToFront`，
     否则截出来永远是第一帧，差分会得到「天空水面完全静止」的假结论；
  2. `--wait` 以前只挂在 `--eval`/`--click` 上，单纯截图会在导航后 1.8s 就按快门，
     带 opacity 过渡的图层还是透明的，会被误判成「根本没画」—— 现在无条件生效；
  3. 复用 user-data-dir 会缓存 js/css，改完参数截图毫无反应 —— 已 `setCacheDisabled`。
  probe 也已挪到截图**之前**，保证读到的状态就是画面上的状态。
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
