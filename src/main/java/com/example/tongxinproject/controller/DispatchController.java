package com.example.tongxinproject.controller;

import com.example.tongxinproject.common.GeoUtils;
import com.example.tongxinproject.common.Result;
import com.example.tongxinproject.dto.DispatchRequest;
import com.example.tongxinproject.dto.DispatchResponse;
import com.example.tongxinproject.entity.DispatchTask;
import com.example.tongxinproject.mapper.DispatchTaskMapper;
import com.example.tongxinproject.service.FenceService;
import com.example.tongxinproject.service.TrafficService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/dispatch")
public class DispatchController {

    @Autowired
    private DispatchTaskMapper dispatchTaskMapper;

    @Autowired
    private TrafficService trafficService;

    @Autowired
    private FenceService fenceService;

    @PostMapping("/nearest")
    @Transactional
    public Result<DispatchResponse> nearestDispatch(@Valid @RequestBody DispatchRequest request) {
        DispatchRequest.Incident incident = request.getIncident();
        List<DispatchRequest.PoliceUnitData> units = request.getUnits();

        if (incident == null || units == null || units.isEmpty()) {
            return Result.error("请求数据不完整：缺少事件坐标或警力列表");
        }

        double incidentLng = incident.getLng();
        double incidentLat = incident.getLat();

        // 使用三层动态围栏获取警力分布
        FenceService.FenceResult fenceResult = fenceService.getUnitsByFenceLevels(units, incidentLng, incidentLat);

        // 候选层列表：(层级名, 候选列表)
        List<AbstractMap.SimpleEntry<String, List<DispatchRequest.PoliceUnitData>>> layers = Arrays.asList(
            new AbstractMap.SimpleEntry<>("核心圈", fenceResult.getCoreUnits()),
            new AbstractMap.SimpleEntry<>("缓冲圈", fenceResult.getBufferUnits()),
            new AbstractMap.SimpleEntry<>("扩展圈", fenceResult.getExtendedUnits())
        );

        DispatchRequest.PoliceUnitData bestUnit = null;
        double bestTime = Double.MAX_VALUE;
        double bestDistance = Double.MAX_VALUE;
        String bestLevel = "";

        for (var layer : layers) {
            if (!layer.getValue().isEmpty()) {
                bestUnit = findBestUnit(layer.getValue(), incidentLng, incidentLat);
                if (bestUnit != null) {
                    bestLevel = layer.getKey();
                    Map<String, Object> estimate = trafficService.calculateFinalEstimateTime(
                            GeoUtils.haversineDistance(bestUnit.getLng(), bestUnit.getLat(), incidentLng, incidentLat),
                            bestUnit.getTransportMode() != null ? bestUnit.getTransportMode() : "步行",
                            bestUnit.getLng(), bestUnit.getLat(),
                            incidentLng, incidentLat
                    );
                    bestTime = (Double) estimate.get("final_time");
                    bestDistance = GeoUtils.haversineDistance(bestUnit.getLng(), bestUnit.getLat(), incidentLng, incidentLat);
                    break;
                }
            }
        }

        // 保存调度任务
        DispatchTask task = new DispatchTask();
        task.setIncidentLng(incidentLng);
        task.setIncidentLat(incidentLat);
        task.setPoliceUnitId(parseUnitIdSafely(bestUnit));
        task.setDispatchResult(bestUnit != null ? "success" : "failed");
        task.setTaskStatus("assigned");
        task.setDistance(bestUnit != null ? bestDistance : null);
        task.setDispatchTime(LocalDateTime.now());
        task.setCreateTime(LocalDateTime.now());
        task.setUpdateTime(LocalDateTime.now());
        dispatchTaskMapper.insert(task);

        DispatchResponse response = new DispatchResponse();
        response.setMode("dynamic-fence");
        // 实际检查事件点是否在围栏内
        boolean insideFence = checkIncidentInFence(incidentLng, incidentLat, fenceResult);
        response.setIncidentInsideFence(insideFence);
        response.setSelectedUnit(bestUnit);
        response.setDistanceKm(bestUnit != null ? bestDistance : null);
        response.setMessage(bestUnit != null
            ? String.format("成功: 从%s选中 %s, 距离%.2fkm, 预计%.1f分钟", bestLevel, bestUnit.getName(), bestDistance, bestTime)
            : "三层围栏内均无可用警力");
        if (bestUnit != null) {
            // 根据选中层级返回对应围栏的候选项
            List<DispatchRequest.PoliceUnitData> candidates = switch (bestLevel) {
                case "核心圈" -> fenceResult.getCoreUnits();
                case "缓冲圈" -> fenceResult.getBufferUnits();
                case "扩展圈" -> fenceResult.getExtendedUnits();
                default -> List.of();
            };
            response.setCandidatesInFence(candidates.stream().map(DispatchRequest.PoliceUnitData::getUnitId).toList());
        }

        return Result.success(response);
    }

    private DispatchRequest.PoliceUnitData findBestUnit(List<DispatchRequest.PoliceUnitData> candidates,
                                                       double targetLng, double targetLat) {
        DispatchRequest.PoliceUnitData bestUnit = null;
        double bestTime = Double.MAX_VALUE;

        for (DispatchRequest.PoliceUnitData unit : candidates) {
            double distance = GeoUtils.haversineDistance(unit.getLng(), unit.getLat(), targetLng, targetLat);
            String transportMode = unit.getTransportMode() != null ? unit.getTransportMode() : "步行";

            try {
                Map<String, Object> estimate = trafficService.calculateFinalEstimateTime(
                        distance, transportMode,
                        unit.getLng(), unit.getLat(),
                        targetLng, targetLat
                );
                double time = (Double) estimate.get("final_time");
                if (time < bestTime) {
                    bestTime = time;
                    bestUnit = unit;
                }
            } catch (Exception e) {
                double speed = switch (transportMode) {
                    case "骑行" -> 20.0;
                    case "开车" -> 30.0;
                    default -> 7.5;
                };
                double time = (distance / speed) * 60;
                if (time < bestTime) {
                    bestTime = time;
                    bestUnit = unit;
                }
            }
        }
        return bestUnit;
    }

    /**
     * 检查事件点是否在围栏范围内
     */
    private boolean checkIncidentInFence(double lng, double lat, FenceService.FenceResult fenceResult) {
        double distToCenter = GeoUtils.haversineDistance(lng, lat,
            (fenceResult.getCoreUnits().isEmpty() ? 0 : lng), lat);
        return distToCenter <= fenceResult.getExtendedRadius();
    }

    /**
     * 安全解析 unitId 中的数字部分为 Long，解析失败返回 null（不抛异常）
     */
    private Long parseUnitIdSafely(DispatchRequest.PoliceUnitData unit) {
        if (unit == null || unit.getUnitId() == null || unit.getUnitId().isBlank()) {
            return null;
        }
        try {
            String digits = unit.getUnitId().replaceAll("\\D", "");
            if (digits.isEmpty()) return null;
            return Long.valueOf(digits);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
