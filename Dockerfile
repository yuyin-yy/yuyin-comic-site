# 余音的小破站 · 生产镜像
# ---------------------------------------------------------------
# 只是 Node 应用 + 静态文件，依赖全是纯 JS（bcryptjs / mysql2），
# 用 alpine 足够，不需要编译工具链。
FROM node:20-alpine

WORKDIR /app

# 先装依赖，利用镜像层缓存：只有 package 文件变了才重新装
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 再拷贝代码，改页面不会触发重新装依赖
COPY server.js ./
COPY public ./public

# 运行用户降到 node，避免容器内是 root
RUN chown -R node:node /app
USER node

EXPOSE 3000

# 容器健康检查：/api/health 会返回 db 状态，但这里只要求服务活着
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

# 用 exec 形式，SIGTERM 能直接传到 node，server.js 里有优雅关闭
CMD ["node", "server.js"]
