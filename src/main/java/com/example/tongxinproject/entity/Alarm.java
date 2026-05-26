package com.example.tongxinproject.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("alarm")
public class Alarm {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String type;
    private String content;
    private Double lng;
    private Double lat;
    private String address;
    private String reporter;
    private String status;
    private LocalDateTime reportTime;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
