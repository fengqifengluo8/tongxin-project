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
    `event_time` VARCHAR(255),
    `tip` TEXT,
    `lng` DOUBLE,
    `lat` DOUBLE,
    `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_create_time (`create_time`),
    INDEX idx_type (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
