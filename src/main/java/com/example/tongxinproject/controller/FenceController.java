package com.example.tongxinproject.controller;

import com.example.tongxinproject.dto.FencePolygonResponse;
import com.example.tongxinproject.service.FenceService;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/fence")
@Validated
public class FenceController {

    @Autowired
    private FenceService fenceService;

    /**
     * 生成三层不规则动态围栏多边形
     * 综合路况、天气、河流障碍、建筑密集度、红绿灯等因素
     */
    @GetMapping("/dynamic-polygon")
    public FencePolygonResponse getDynamicFencePolygon(
            @RequestParam @NotNull(message = "经度不能为空")
            @DecimalMin(value = "-180.0", message = "经度必须在-180到180之间")
            @DecimalMax(value = "180.0", message = "经度必须在-180到180之间")
            Double lng,
            @RequestParam @NotNull(message = "纬度不能为空")
            @DecimalMin(value = "-90.0", message = "纬度必须在-90到90之间")
            @DecimalMax(value = "90.0", message = "纬度必须在-90到90之间")
            Double lat) {
        return fenceService.generateDynamicFencePolygon(lng, lat);
    }

    /**
     * 获取围栏配置信息（简化版）
     */
    @GetMapping("/config")
    public Map<String, Object> getFenceConfig(
            @RequestParam @NotNull(message = "经度不能为空")
            @DecimalMin(value = "-180.0")
            @DecimalMax(value = "180.0")
            Double lng,
            @RequestParam @NotNull(message = "纬度不能为空")
            @DecimalMin(value = "-90.0")
            @DecimalMax(value = "90.0")
            Double lat) {
        return fenceService.getFenceConfig(lng, lat);
    }
}
