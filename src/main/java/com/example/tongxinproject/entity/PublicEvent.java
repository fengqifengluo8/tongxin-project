package com.example.tongxinproject.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("public_event")
public class PublicEvent {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String type;
    private String title;
    private String area;
    private String eventTime;
    private String tip;
    private Double lng;
    private Double lat;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
