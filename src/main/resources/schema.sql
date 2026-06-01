CREATE DATABASE IF NOT EXISTS tongxin DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE tongxin;

CREATE TABLE IF NOT EXISTS `user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(100) NOT NULL UNIQUE,
    `password` VARCHAR(255) NOT NULL,
    `role` VARCHAR(50) NOT NULL COMMENT 'commander/officer/guest',
    `nickname` VARCHAR(100),
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (`username`),
    INDEX idx_role (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `police_unit` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `unit_id` VARCHAR(100) NOT NULL UNIQUE,
    `name` VARCHAR(100) NOT NULL,
    `lng` DOUBLE,
    `lat` DOUBLE,
    `available` TINYINT(1) DEFAULT 1,
    `position_update_time` DATETIME,
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_unit_id (`unit_id`),
    INDEX idx_available (`available`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dispatch_task` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `incident_lng` DOUBLE,
    `incident_lat` DOUBLE,
    `police_unit_id` BIGINT,
    `dispatch_result` VARCHAR(255),
    `task_status` VARCHAR(50),
    `distance` DOUBLE,
    `dispatch_time` DATETIME,
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_task_status (`task_status`),
    INDEX idx_police_unit_id (`police_unit_id`),
    INDEX idx_incident_location (`incident_lng`, `incident_lat`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `alarm` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `type` VARCHAR(100),
    `content` TEXT,
    `lng` DOUBLE,
    `lat` DOUBLE,
    `address` VARCHAR(500),
    `reporter` VARCHAR(100),
    `status` VARCHAR(50) DEFAULT 'pending',
    `report_time` DATETIME,
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (`status`),
    INDEX idx_type (`type`),
    INDEX idx_reporter (`reporter`),
    INDEX idx_report_time (`report_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `public_event` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `type` VARCHAR(100),
    `title` VARCHAR(255),
    `area` VARCHAR(255),
    `event_time` DATETIME COMMENT '事件发生时间',
    `tip` TEXT,
    `lng` DOUBLE,
    `lat` DOUBLE,
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_create_time (`create_time`),
    INDEX idx_type (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 围栏表 (E-R 设计中缺失)
CREATE TABLE IF NOT EXISTS `fence` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `fence_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '围栏业务ID',
    `center_lng` DOUBLE COMMENT '中心经度',
    `center_lat` DOUBLE COMMENT '中心纬度',
    `radius` DOUBLE COMMENT '围栏半径(km)',
    `boundary_coords` TEXT COMMENT '边界坐标(JSON数组)',
    `fence_type` VARCHAR(50) COMMENT '围栏类型: CORE/BUFFER/EXTENDED',
    `status` VARCHAR(20) DEFAULT 'active' COMMENT '状态: active/inactive',
    `incident_id` BIGINT COMMENT '关联警情ID',
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fence_id (`fence_id`),
    INDEX idx_fence_type (`fence_type`),
    INDEX idx_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 警务指令表 (E-R 设计中缺失)
CREATE TABLE IF NOT EXISTS `command` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `command_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '指令业务ID',
    `content` TEXT COMMENT '指令内容',
    `command_type` VARCHAR(50) COMMENT '指令类型: 处置/巡逻/支援/待命',
    `send_time` DATETIME COMMENT '发送时间',
    `status` VARCHAR(20) DEFAULT 'sent' COMMENT '状态: sent/received/ack/executed',
    `from_user_id` BIGINT COMMENT '发送者用户ID',
    `to_user_id` BIGINT COMMENT '接收者用户ID',
    `dispatch_task_id` BIGINT COMMENT '关联派警记录ID',
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_command_id (`command_id`),
    INDEX idx_command_type (`command_type`),
    INDEX idx_status (`status`),
    INDEX idx_to_user_id (`to_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
