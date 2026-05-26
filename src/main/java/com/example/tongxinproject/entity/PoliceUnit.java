package com.example.tongxinproject.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("police_unit")
public class PoliceUnit {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String unitId;
    private String name;
    private Double lng;
    private Double lat;
    private Boolean available;
    private LocalDateTime positionUpdateTime;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
