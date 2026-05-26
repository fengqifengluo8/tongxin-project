package com.example.tongxinproject.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("dispatch_task")
public class DispatchTask {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Double incidentLng;
    private Double incidentLat;
    private Long policeUnitId;
    private String dispatchResult;
    private String taskStatus;
    private Double distance;
    private LocalDateTime dispatchTime;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
