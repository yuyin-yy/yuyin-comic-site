-- ============================================================
-- 余音的小破站 · 账号级追漫清单
-- 用法（裸机）：mysql < deploy/favorites.sql
-- 说明：comic_id 对应 data.js 里的作品 id（当前是数字，留 VARCHAR 兼容以后变化）
-- ============================================================

CREATE TABLE IF NOT EXISTS `favorites` (
  `user_id`    INT UNSIGNED NOT NULL COMMENT '用户 id（users.id）',
  `comic_id`   VARCHAR(32)  NOT NULL COMMENT '作品 id（data.js 里的 id）',
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '收藏时间',
  PRIMARY KEY (`user_id`, `comic_id`),
  KEY `idx_user_time` (`user_id`, `created_at`),
  CONSTRAINT `fk_fav_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='账号级追漫清单';

-- 应用账号需要删除收藏的权限（只给这一张表，不动 users）
-- GRANT DELETE ON yuyin_comic.favorites TO 'comic'@'localhost';
-- FLUSH PRIVILEGES;
