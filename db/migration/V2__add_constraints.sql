-- ==========================================
-- V2 迁移: 外键约束 + 复合索引 + 审计日志表
-- 首次部署后执行: mysql -u root -p < this_file.sql
-- ==========================================

DELIMITER //

-- === 安全添加外键约束（跳过已存在的） ===
CREATE PROCEDURE IF NOT EXISTS add_fk_if_not_exists(
    IN tbl VARCHAR(128), IN fk_name VARCHAR(128),
    IN fk_col VARCHAR(128), IN ref_tbl VARCHAR(128), IN ref_col VARCHAR(128),
    IN on_delete VARCHAR(32))
BEGIN
    SET @cnt = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND CONSTRAINT_NAME = fk_name);
    IF @cnt = 0 THEN
        SET @sql = CONCAT('ALTER TABLE ', tbl, ' ADD CONSTRAINT ', fk_name,
            ' FOREIGN KEY (', fk_col, ') REFERENCES ', ref_tbl, '(', ref_col, ') ON DELETE ', on_delete);
        PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END//

DELIMITER ;

CALL add_fk_if_not_exists('dispatch_task', 'fk_dispatch_unit', 'police_unit_id', 'police_unit', 'id', 'SET NULL');
CALL add_fk_if_not_exists('fence', 'fk_fence_alarm', 'incident_id', 'alarm', 'id', 'SET NULL');
CALL add_fk_if_not_exists('command', 'fk_command_from_user', 'from_user_id', 'user', 'id', 'SET NULL');
CALL add_fk_if_not_exists('command', 'fk_command_to_user', 'to_user_id', 'user', 'id', 'SET NULL');
CALL add_fk_if_not_exists('command', 'fk_command_dispatch', 'dispatch_task_id', 'dispatch_task', 'id', 'SET NULL');

DROP PROCEDURE IF EXISTS add_fk_if_not_exists;

-- === 补充复合索引 ===
CREATE INDEX IF NOT EXISTS idx_alarm_status_time ON alarm(status, report_time DESC);
CREATE INDEX IF NOT EXISTS idx_command_from_user ON command(from_user_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_time ON dispatch_task(dispatch_time);
CREATE INDEX IF NOT EXISTS idx_public_event_type_time ON public_event(type, create_time DESC);

-- === 审计日志表 ===
CREATE TABLE IF NOT EXISTS operation_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT,
    username VARCHAR(100),
    action VARCHAR(50) NOT NULL COMMENT 'LOGIN/DISPATCH/COMMAND/REPORT/FEEDBACK',
    target_type VARCHAR(50),
    target_id VARCHAR(100),
    detail TEXT COMMENT 'JSON操作详情',
    ip_address VARCHAR(45),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
