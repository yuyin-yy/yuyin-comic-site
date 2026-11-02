/**
 * PM2 进程配置（裸机部署用，不装 Docker 时选它）
 * ---------------------------------------------------------------
 * 用法（在项目根目录执行）：
 *   npm i -g pm2
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save && pm2 startup     # 开机自启
 *
 * 说明：server.js 的静态托管目录是「server.js 所在目录/public」，
 * 所以 cwd 必须指到项目根，不能指到 deploy/。
 */
const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'comic',
      script: 'server.js',
      cwd: root,
      instances: 1,           // 单实例：站点是无状态的，但 2C2G 没必要开 cluster
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      // 环境变量优先从 .env 读取（server.js 里用了 dotenv），这里只兜底关键项
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      out_file: path.join(root, 'logs/out.log'),
      error_file: path.join(root, 'logs/err.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // 重启太频繁说明配置有问题，别让它无限循环刷日志
      min_uptime: '10s',
      max_restarts: 10
    }
  ]
};
