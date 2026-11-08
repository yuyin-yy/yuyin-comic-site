/**
 * 余音的小破站 · 服务端
 * ---------------------------------------------------------------
 * 职责：1) 托管 public 静态站点  2) 提供注册 / 登录 / JWT 鉴权接口
 *
 * 相较旧版修复：
 *  - 补上 express.static，静态页面不再需要另外开服务
 *  - 统一 JWT 密钥（旧版签发用 'secretKey'，校验用 secretKey，导致 /api/protected 必然 403）
 *  - 数据库连接池改为 mysql2/promise，避免 getConnection 未 release 造成的连接泄漏
 *  - 数据库不可用时不再 throw 直接退出，静态站点仍可访问
 *  - 输入校验、统一 JSON 错误响应、不再打印明文密码
 */
'use strict';

const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// 环境变量：优先 .env，其次项目内的 sql.env
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, 'sql.env') });

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'yy-dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '2h';

if (!process.env.JWT_SECRET) {
  console.warn('[warn] 未配置 JWT_SECRET，正在使用开发默认值，请勿用于生产环境');
}

/* ---------------- 数据库 ---------------- */
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'test',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_general_ci'
});

// 启动时探测一次，不阻塞静态站点
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.query('SELECT 1');
    conn.release();
    console.log('[db] 数据库连接正常');
  } catch (err) {
    console.warn('[warn] 数据库连接失败，注册/登录不可用：', err.code || err.message);
  }
})();

/* ---------------- 中间件 ---------------- */
app.disable('x-powered-by');

// 基础安全响应头（不引依赖；不设 CSP，页面有内联样式/脚本会被误伤）
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// 只允许本站与本地调试来源，同时兼容直接打开 file:// 的场景
const ALLOW_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // file:// / 同源 / curl
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    if (ALLOW_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '32kb' }));

// 旧地址兜底：「全部漫画」页已并入分类页，历史书签/外部链接不要变成 404
const LEGACY_ROUTES = {
  '/index01.html': '/category.html',
  '/index01': '/category.html',
  '/browse.html': '/category.html'
};

app.get(Object.keys(LEGACY_ROUTES), (req, res) => {
  const to = LEGACY_ROUTES[req.path.replace(/\/+$/, '')] || '/category.html';
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, to + qs);
});

// 静态站点
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

/* ---------------- 工具 ---------------- */
const USERNAME_RE = /^[\w\u4e00-\u9fa5]{3,20}$/;

function bad(res, code, message) {
  return res.status(code).json({ success: false, message });
}

/* ---------------- 简易限流（内存版，单进程够用） ----------------
 * 目的：挡住针对 /api/login、/api/register 的暴力撞库与垃圾注册。
 * 说明：
 *  - 用 req.socket.remoteAddress 而不是 X-Forwarded-For，避免伪造请求头绕过；
 *    以后若在前面加反代，需要改为读取受信任的代理头。
 *  - 固定窗口计数，每分钟清理一次过期记录，Map 不会无限增长。
 */
const RATE = new Map();

function rateLimit(bucket, limit, windowMs) {
  return (req, res, next) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const key = bucket + '|' + ip;
    const now = Date.now();
    let rec = RATE.get(key);
    if (!rec || rec.resetAt <= now) rec = { count: 0, resetAt: now + windowMs };
    rec.count += 1;
    RATE.set(key, rec);
    if (rec.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
      return bad(res, 429, '请求过于频繁，请稍后再试');
    }
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of RATE) if (v.resetAt <= now) RATE.delete(k);
}, 60 * 1000).unref();

/* ---------------- 注册 ---------------- */
// 每 IP 每分钟最多 10 次，防批量注册
app.post('/api/register', rateLimit('register', 10, 60 * 1000), async (req, res, next) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');

  if (!USERNAME_RE.test(username)) {
    return bad(res, 400, '用户名需为 3-20 位中文、字母、数字或下划线');
  }
  if (password.length < 6 || password.length > 64) {
    return bad(res, 400, '密码长度需为 6-64 位');
  }

  try {
    const [exists] = await pool.execute(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (exists.length) return bad(res, 409, '该用户名已被注册');

    const hashed = await bcrypt.hash(password, 10);
    await pool.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed]);

    console.log('[register] 新用户：%s', username);
    return res.status(201).json({ success: true, message: '注册成功' });
  } catch (err) {
    return next(err);
  }
});

/* ---------------- 登录 ---------------- */
// 每 IP 每分钟最多 10 次，防撞库
app.post('/api/login', rateLimit('login', 10, 60 * 1000), async (req, res, next) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');

  if (!username || !password) return bad(res, 400, '用户名和密码不能为空');

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, password FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (!rows.length) return bad(res, 401, '用户名或密码错误');

    const valid = await bcrypt.compare(password, rows[0].password);
    if (!valid) return bad(res, 401, '用户名或密码错误');

    const token = jwt.sign(
      { id: rows[0].id, username: rows[0].username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    return res.json({
      success: true,
      message: '登录成功',
      token,
      user: { id: rows[0].id, username: rows[0].username }
    });
  } catch (err) {
    return next(err);
  }
});

/* ---------------- 鉴权 ---------------- */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return bad(res, 401, '缺少登录凭证');

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return bad(res, 403, '登录已失效，请重新登录');
    req.user = payload;
    next();
  });
}

app.get('/api/me', auth, (req, res) => {
  res.json({ success: true, user: { id: req.user.id, username: req.user.username } });
});

// 兼容旧版前端调用的受保护路由
app.get('/api/protected', auth, (req, res) => {
  res.json({ success: true, message: '您已成功访问受保护的资源', user: req.user.username });
});

/* ---------------- 追漫清单（账号级收藏） ---------------- */
// 单次请求最多同步的条目数，防止刷接口
const FAV_LIMIT = 2000;

/** 清洗 id 数组：只保留 1-32 位的字母数字下划线连字符 */
function normIds(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim())
    .filter((x) => /^[A-Za-z0-9_-]{1,32}$/.test(x))
    .slice(0, FAV_LIMIT);
}

async function listFavs(userId) {
  const [rows] = await pool.execute(
    'SELECT comic_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
  return rows.map((r) => r.comic_id);
}

app.get('/api/favs', rateLimit('favs', 120, 60 * 1000), auth, async (req, res, next) => {
  try {
    res.json({ success: true, list: await listFavs(req.user.id) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/favs/sync', rateLimit('favs', 120, 60 * 1000), auth, async (req, res, next) => {
  const add = normIds(req.body && req.body.add);
  const remove = normIds(req.body && req.body.remove);

  try {
    if (add.length) {
      const values = add.map(() => '(?, ?)').join(',');
      const params = [];
      add.forEach((id) => params.push(req.user.id, id));
      await pool.query(
        'INSERT IGNORE INTO favorites (user_id, comic_id) VALUES ' + values,
        params
      );
    }
    if (remove.length) {
      const marks = remove.map(() => '?').join(',');
      await pool.query(
        'DELETE FROM favorites WHERE user_id = ? AND comic_id IN (' + marks + ')',
        [req.user.id].concat(remove)
      );
    }
    res.json({ success: true, list: await listFavs(req.user.id) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', async (_req, res) => {
  let db = 'down';
  try {
    const conn = await pool.getConnection();
    await conn.query('SELECT 1');
    conn.release();
    db = 'up';
  } catch (_) { /* 忽略，按 down 返回 */ }
  res.json({ success: true, db, uptime: Math.round(process.uptime()) });
});

/* ---------------- 兜底 ---------------- */
app.use('/api', (_req, res) => bad(res, 404, '接口不存在'));

// 页面找不到时给一个可点的 404 页；图片/脚本等静态资源仍按原样返回状态码
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) return next();
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err.code || '', err.message);
  if (err.code === 'ER_NO_SUCH_TABLE') {
    return bad(res, 500, '数据表不存在，请先执行建表语句');
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
    return bad(res, 503, '数据库不可用，请检查 MySQL 是否启动');
  }
  return bad(res, 500, '服务器内部错误');
});

const server = app.listen(PORT, () => {
  console.log(`服务已启动：http://localhost:${PORT}`);
  console.log(`静态站点目录：${path.join(__dirname, 'public')}`);
});

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.log('\n正在关闭服务…');
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
});
