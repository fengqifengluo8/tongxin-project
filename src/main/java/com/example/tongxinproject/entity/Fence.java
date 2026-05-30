package com.example.tongxinproject.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("fence")
public class Fence {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String fenceId;
    private Double centerLng;
    private Double centerLat;
    private Double radius;
    private String boundaryCoords;
    private String fenceType;
    private String status;
    private Long incidentId;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
