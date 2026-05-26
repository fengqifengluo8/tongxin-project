package com.example.tongxinproject.controller;

import com.example.tongxinproject.dto.FencePolygonResponse;
import com.example.tongxinproject.service.FenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/fence")
public class FenceController {

    @Autowired
    private FenceService fenceService;

    /**
     * 生成三层不规则动态围栏多边形
     * 综合路况、天气、河流障碍、建筑密集度、红绿灯等因素
     * 
     * @param lng 事件中心点经度
     * @param lat 事件中心点纬度
     */
    @GetMapping("/dynamic-polygon")
    public FencePolygonResponse getDynamicFencePolygon(
            @RequestParam double lng,
            @RequestParam double lat) {
        return fenceService.generateDynamicFencePolygon(lng, lat);
    }

    /**
     * 获取围栏配置信息（简化版）
     */
    @GetMapping("/config")
    public Map<String, Object> getFenceConfig(
            @RequestParam double lng,
            @RequestParam double lat) {
        return fenceService.getFenceConfig(lng, lat);
    }
}