-- ============================================================
-- 余音的小破站 · 建表脚本
-- 用法一（Docker）：放在 docker-entrypoint-initdb.d 下，首次启动自动执行
-- 用法二（裸机）：mysql -uroot -p < deploy/users.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `yuyin_comic`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE `yuyin_comic`;

-- 账号表：只存用户名与 bcrypt 哈希，不存明文密码
CREATE TABLE IF NOT EXISTS `users` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `username`   VARCHAR(20)  NOT NULL                COMMENT '用户名，3-20 位中英文数字下划线',
  `password`   VARCHAR(100) NOT NULL                COMMENT 'bcrypt 哈希，固定 60 字符，留余量',
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  `last_login` TIMESTAMP    NULL     DEFAULT NULL   COMMENT '最后登录时间，暂未写入',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='站点账号';

-- 给应用账号授权（Docker 里 MYSQL_USER 会自动授权，裸机部署需要手动执行）
-- CREATE USER IF NOT EXISTS 'comic'@'localhost' IDENTIFIED BY '改成你的密码';
-- GRANT SELECT, INSERT, UPDATE ON yuyin_comic.* TO 'comic'@'localhost';
-- FLUSH PRIVILEGES;
