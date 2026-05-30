package com.example.tongxinproject.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("command")
public class Command {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String commandId;
    private String content;
    private String commandType;
    private LocalDateTime sendTime;
    private String status;
    private Long fromUserId;
    private Long toUserId;
    private Long dispatchTaskId;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
