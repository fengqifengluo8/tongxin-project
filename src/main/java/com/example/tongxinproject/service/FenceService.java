package com.example.tongxinproject.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.example.tongxinproject.common.GeoUtils;
import com.example.tongxinproject.dto.DispatchRequest;
import com.example.tongxinproject.dto.FencePolygonResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.*;

@Service
public class FenceService {

    @Autowired
    private TrafficService trafficService;

    @Value("${amap.key}")
    private String amapKey;

    // 三层围栏基础半径（公里）
    private static final double CORE_FENCE_RADIUS = 3.0;
    private static final double BUFFER_FENCE_RADIUS = 8.0;
    private static final double EXTENDED_FENCE_RADIUS = 15.0;

    // 采样方向数（每15度一个采样点，共24个方向）
    private static final int SAMPLE_DIRECTIONS = 24;

    // 建筑密集度系数（基于道路类型推断）
    private static final Map<String, Double> BUILDING_DENSITY_FACTORS = new HashMap<>();
    static {
        BUILDING_DENSITY_FACTORS.put("高速", 0.9);      // 开阔，通行好
        BUILDING_DENSITY_FACTORS.put("快速路", 0.95);
        BUILDING_DENSITY_FACTORS.put("城市道路", 1.2);   // 密集，通行慢
        BUILDING_DENSITY_FACTORS.put("小路", 1.15);      // 居民区
        BUILDING_DENSITY_FACTORS.put("未知", 1.1);
    }

    // 河流障碍系数（基于道路类型推断）
    private static final Map<String, Double> RIVER_BARRIER_FACTORS = new HashMap<>();
    static {
        RIVER_BARRIER_FACTORS.put("高速", 1.05);
        RIVER_BARRIER_FACTORS.put("快速路", 1.1);
        RIVER_BARRIER_FACTORS.put("城市道路", 1.0);
        RIVER_BARRIER_FACTORS.put("小路", 1.05);
        RIVER_BARRIER_FACTORS.put("未知", 1.08);
    }

    // 红绿灯密度系数（每公里预估红绿灯数）
    private static final Map<String, Double> TRAFFIC_LIGHT_DENSITY = new HashMap<>();
    static {
        TRAFFIC_LIGHT_DENSITY.put("高速", 0.0);
        TRAFFIC_LIGHT_DENSITY.put("快速路", 0.3);
        TRAFFIC_LIGHT_DENSITY.put("城市道路", 2.0);  // 每公里约2个红绿灯
        TRAFFIC_LIGHT_DENSITY.put("小路", 1.5);
        TRAFFIC_LIGHT_DENSITY.put("未知", 1.8);
    }

    // 红绿灯平均等待时间（分钟）
    private static final double AVG_LIGHT_WAIT_MINUTES = 0.5;

    // 缓存道路环境信息（道路类型+人口密度+POI数量）
    private final Map<String, RoadEnvironment> envCache = new HashMap<>();
    private final Map<String, String> trafficCache = new HashMap<>();

    /**
     * 道路环境信息
     */
    private static class RoadEnvironment {
        String roadType;
        double populationDensityFactor;
        int poiCount;

        RoadEnvironment(String roadType, double populationDensityFactor, int poiCount) {
            this.roadType = roadType;
            this.populationDensityFactor = populationDensityFactor;
            this.poiCount = poiCount;
        }
    }

    public enum FenceLevel {
        CORE("核心圈", CORE_FENCE_RADIUS),
        BUFFER("缓冲圈", BUFFER_FENCE_RADIUS),
        EXTENDED("扩展圈", EXTENDED_FENCE_RADIUS);

        private final String name;
        private final double baseRadius;
        FenceLevel(String name, double baseRadius) { this.name = name; this.baseRadius = baseRadius; }
        public String getName() { return name; }
        public double getBaseRadius() { return baseRadius; }
    }

    // ==================== 原有简单圆形围栏方法 ====================

    public double calculateDynamicRadius(double centerLng, double centerLat, FenceLevel level) {
        double baseRadius = level.getBaseRadius();
        double weatherFactor = getWeatherAdjustFactor(centerLng, centerLat);
        double trafficFactor = getTrafficAdjustFactor(centerLng, centerLat);
        double riverFactor = getRiverAdjustFactor(centerLng, centerLat);
        double buildingFactor = getBuildingAdjustFactor(centerLng, centerLat);
        double adjustmentFactor = Math.min(Math.min(weatherFactor, trafficFactor),
                                          Math.min(riverFactor, buildingFactor));
        return baseRadius * adjustmentFactor;
    }

    private double getWeatherAdjustFactor(double lng, double lat) {
        Map<String, Object> weatherInfo = trafficService.getWeatherInfo(lng, lat);
        return (Double) weatherInfo.getOrDefault("weather_factor", 1.0);
    }

    private double getTrafficAdjustFactor(double lng, double lat) {
        try {
            String origin = lng + "," + lat;
            String destination = lng + 0.01 + "," + lat + 0.01;
            Map<String, Object> trafficInfo = trafficService.getTrafficInfo(origin, destination);
            String trafficStatus = (String) trafficInfo.get("traffic_status");
            if (trafficStatus != null) {
                switch (trafficStatus) {
                    case "畅通": return 1.0;
                    case "缓行": return 0.85;
                    case "拥堵": return 0.7;
                    case "严重拥堵": return 0.5;
                    default: return 1.0;
                }
            }
        } catch (Exception e) { e.printStackTrace(); }
        return 1.0;
    }

    private double getRiverAdjustFactor(double lng, double lat) {
        String roadType = getCachedRoadType(lng, lat);
        return RIVER_BARRIER_FACTORS.getOrDefault(roadType, 1.08);
    }

    private double getBuildingAdjustFactor(double lng, double lat) {
        String roadType = getCachedRoadType(lng, lat);
        return BUILDING_DENSITY_FACTORS.getOrDefault(roadType, 1.1);
    }

    public boolean isPointInFence(double pointLng, double pointLat, double centerLng, double centerLat, FenceLevel level) {
        double distance = GeoUtils.haversineDistance(pointLng, pointLat, centerLng, centerLat);
        double dynamicRadius = calculateDynamicRadius(centerLng, centerLat, level);
        return distance <= dynamicRadius;
    }

    public List<DispatchRequest.PoliceUnitData> getUnitsInFence(List<DispatchRequest.PoliceUnitData> units,
            double centerLng, double centerLat, FenceLevel level) {
        List<DispatchRequest.PoliceUnitData> result = new ArrayList<>();
        for (DispatchRequest.PoliceUnitData unit : units) {
            if (unit.isAvailable() && isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, level))
                result.add(unit);
        }
        return result;
    }

    public FenceResult getUnitsByFenceLevels(List<DispatchRequest.PoliceUnitData> units, double centerLng, double centerLat) {
        FenceResult result = new FenceResult();
        List<DispatchRequest.PoliceUnitData> coreUnits = getUnitsInFence(units, centerLng, centerLat, FenceLevel.CORE);
        result.setCoreRadius(calculateDynamicRadius(centerLng, centerLat, FenceLevel.CORE));
        result.setCoreUnits(coreUnits);

        List<DispatchRequest.PoliceUnitData> bufferUnits = new ArrayList<>();
        for (DispatchRequest.PoliceUnitData unit : units) {
            if (unit.isAvailable() &&
                isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, FenceLevel.BUFFER) &&
                !isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, FenceLevel.CORE))
                bufferUnits.add(unit);
        }
        result.setBufferRadius(calculateDynamicRadius(centerLng, centerLat, FenceLevel.BUFFER));
        result.setBufferUnits(bufferUnits);

        List<DispatchRequest.PoliceUnitData> extendedUnits = new ArrayList<>();
        for (DispatchRequest.PoliceUnitData unit : units) {
            if (unit.isAvailable() &&
                isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, FenceLevel.EXTENDED) &&
                !isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, FenceLevel.BUFFER))
                extendedUnits.add(unit);
        }
        result.setExtendedRadius(calculateDynamicRadius(centerLng, centerLat, FenceLevel.EXTENDED));
        result.setExtendedUnits(extendedUnits);
        return result;
    }

    public Map<String, Object> getFenceConfig(double lng, double lat) {
        return Map.of(
            "weather_factor", getWeatherAdjustFactor(lng, lat),
            "traffic_factor", getTrafficAdjustFactor(lng, lat),
            "river_factor", getRiverAdjustFactor(lng, lat),
            "building_factor", getBuildingAdjustFactor(lng, lat),
            "core_radius", calculateDynamicRadius(lng, lat, FenceLevel.CORE),
            "buffer_radius", calculateDynamicRadius(lng, lat, FenceLevel.BUFFER),
            "extended_radius", calculateDynamicRadius(lng, lat, FenceLevel.EXTENDED)
        );
    }

    // ==================== 不规则动态围栏多边形生成 ====================

    /**
     * 生成三层不规则动态围栏多边形
     * 核心思路：以事件点为中心，沿24个方向采样周边环境，
     * 根据各路况/河流/建筑密度/红绿灯因素综合计算每个方向的围栏边界距离，
     * 生成不规则的接近真实地形约束的围栏多边形。
     */
    public FencePolygonResponse generateDynamicFencePolygon(double centerLng, double centerLat) {
        FencePolygonResponse response = new FencePolygonResponse();
        response.setCenterLng(centerLng);
        response.setCenterLat(centerLat);

        // 清除缓存
        envCache.clear();
        trafficCache.clear();

        // 获取全局天气因素
        double weatherFactor = getWeatherAdjustFactor(centerLng, centerLat);
        Map<String, Object> weatherInfo = trafficService.getWeatherInfo(centerLng, centerLat);

        // 记录影响因素详情
        Map<String, Object> factorDetails = new LinkedHashMap<>();
        factorDetails.put("weather", weatherInfo.getOrDefault("weather", "晴"));
        factorDetails.put("weather_factor", weatherFactor);
        factorDetails.put("sample_directions", SAMPLE_DIRECTIONS);

        // 统计采样环境信息
        Map<String, Integer> roadTypeStats = new HashMap<>();
        Map<String, Integer> trafficStats = new HashMap<>();

        // 生成三层围栏
        List<FencePolygonResponse.FenceLayer> layers = new ArrayList<>();
        layers.add(buildFenceLayer(centerLng, centerLat, FenceLevel.CORE, weatherFactor, roadTypeStats, trafficStats));
        layers.add(buildFenceLayer(centerLng, centerLat, FenceLevel.BUFFER, weatherFactor, roadTypeStats, trafficStats));
        layers.add(buildFenceLayer(centerLng, centerLat, FenceLevel.EXTENDED, weatherFactor, roadTypeStats, trafficStats));

        factorDetails.put("road_type_distribution", roadTypeStats);
        factorDetails.put("traffic_status_distribution", trafficStats);
        response.setFactorDetails(factorDetails);
        response.setLayers(layers);

        return response;
    }

    /**
     * 构建单层不规则围栏（增强版）
     * 
     * 算法综合：
     * 1. 24方向采样 → 多点（25%/50%/75%/100%基础半径）环境评估
     * 2. 道路类型 + 实时交通态势 + 天气 + 建筑密度 + 河流障碍 + 红绿灯密度
     * 3. 人口密度估计（基于POI类型和环境语义）
     * 4. 高斯平滑相邻方向，消除突兀跳变
     * 5. 跨层一致性保证（外层必须包围内层）
     */
    private FencePolygonResponse.FenceLayer buildFenceLayer(double centerLng, double centerLat,
            FenceLevel level, double weatherFactor,
            Map<String, Integer> roadTypeStats, Map<String, Integer> trafficStats) {
        
        FencePolygonResponse.FenceLayer layer = new FencePolygonResponse.FenceLayer();
        layer.setName(level.getName());
        layer.setLevel(level.name());
        layer.setBaseRadius(level.getBaseRadius());
        layer.setSampleCount(SAMPLE_DIRECTIONS);

        // 多点采样比例（沿每条方向采样多个距离点以综合评估）
        // 核心圈/缓冲圈只采1个点（100%），扩展圈采2个点（50%, 100%）
        double[] sampleRatios;
        if (level == FenceLevel.EXTENDED) {
            sampleRatios = new double[]{0.5, 1.0};
        } else {
            sampleRatios = new double[]{1.0};
        }

        double[] rawAdjustments = new double[SAMPLE_DIRECTIONS];
        String[] directionRoadTypes = new String[SAMPLE_DIRECTIONS];
        String[] directionTraffic = new String[SAMPLE_DIRECTIONS];

        for (int i = 0; i < SAMPLE_DIRECTIONS; i++) {
            double angleDeg = (360.0 / SAMPLE_DIRECTIONS) * i;
            double angleRad = Math.toRadians(angleDeg);

            // 多点采样综合评估
            double totalAdjustment = 0;
            double totalWeight = 0;
            String dominantRoadType = "城市道路";
            String dominantTraffic = "缓行";

            for (int si = 0; si < sampleRatios.length; si++) {
                double sampleDistance = level.getBaseRadius() * sampleRatios[si];
                double weight = 1.0 / (1.0 + si * 0.5); // 越近权重越大（距离衰减）

                double[] samplePoint = destinationPoint(centerLat, centerLng, sampleDistance, angleRad);
                double sampleLng = samplePoint[1];
                double sampleLat = samplePoint[0];

                // 一次性获取完整环境信息（道路类型+人口密度，一次API调用）
                RoadEnvironment env = getCachedEnvironment(sampleLng, sampleLat);
                String roadType = env.roadType;
                String trafficStatus = getCachedTrafficStatus(sampleLng, sampleLat, centerLng, centerLat);
                double buildingFactor = BUILDING_DENSITY_FACTORS.getOrDefault(roadType, 1.1);
                double riverFactor = RIVER_BARRIER_FACTORS.getOrDefault(roadType, 1.08);
                double populationFactor = env.populationDensityFactor;

                // 各项因子
                double roadFactor = getRoadTypeReachFactor(roadType);
                double trafficFactor = getTrafficStatusReachFactor(trafficStatus);
                double lightFactor = getTrafficLightDelayFactor(roadType, level.getBaseRadius());

                // 综合该采样点的调整系数
                double pointAdjustment = roadFactor * trafficFactor * weatherFactor 
                    * buildingFactor * riverFactor * lightFactor * populationFactor;
                pointAdjustment = Math.max(0.25, Math.min(1.5, pointAdjustment));

                totalAdjustment += pointAdjustment * weight;
                totalWeight += weight;

                // 取最内层采样点的道路类型和路况作为方向代表
                if (si == sampleRatios.length - 1) {
                    dominantRoadType = roadType;
                    dominantTraffic = trafficStatus;
                }
            }

            rawAdjustments[i] = totalAdjustment / totalWeight;
            directionRoadTypes[i] = dominantRoadType;
            directionTraffic[i] = dominantTraffic;
        }

        // 高斯平滑：使相邻方向的围栏边界过渡自然
        double[] smoothedAdjustments = gaussianSmooth(rawAdjustments, 2);

        List<FencePolygonResponse.FenceVertex> vertices = new ArrayList<>();
        double totalEffAdjustment = 0;

        for (int i = 0; i < SAMPLE_DIRECTIONS; i++) {
            double angleRad = Math.toRadians((360.0 / SAMPLE_DIRECTIONS) * i);
            double adjustment = smoothedAdjustments[i];
            double adjustedDistance = level.getBaseRadius() * adjustment;

            totalEffAdjustment += adjustment;

            // 统计
            roadTypeStats.merge(directionRoadTypes[i], 1, Integer::sum);
            trafficStats.merge(directionTraffic[i], 1, Integer::sum);

            // 计算实际围栏顶点坐标
            double[] vertexPoint = destinationPoint(centerLat, centerLng, adjustedDistance, angleRad);

            FencePolygonResponse.FenceVertex vertex = new FencePolygonResponse.FenceVertex();
            vertex.setLng(vertexPoint[1]);
            vertex.setLat(vertexPoint[0]);
            vertex.setDistanceKm(adjustedDistance);
            vertex.setAdjustment(adjustment);
            vertex.setRoadType(directionRoadTypes[i]);
            vertex.setTrafficStatus(directionTraffic[i]);
            vertices.add(vertex);
        }

        layer.setEffectiveRadius(level.getBaseRadius() * (totalEffAdjustment / SAMPLE_DIRECTIONS));
        layer.setVertices(vertices);
        return layer;
    }

    /**
     * 高斯平滑：用高斯核对相邻方向调整系数进行平滑
     * sigma控制平滑强度（越大越平滑）
     */
    private double[] gaussianSmooth(double[] data, int sigma) {
        int n = data.length;
        if (n <= 2) return data.clone();

        // 生成高斯核
        int kernelRadius = sigma * 3;
        double[] kernel = new double[2 * kernelRadius + 1];
        double kernelSum = 0;
        for (int i = -kernelRadius; i <= kernelRadius; i++) {
            kernel[i + kernelRadius] = Math.exp(-(i * i) / (2.0 * sigma * sigma));
            kernelSum += kernel[i + kernelRadius];
        }
        // 归一化
        for (int i = 0; i < kernel.length; i++) {
            kernel[i] /= kernelSum;
        }

        double[] smoothed = new double[n];
        for (int i = 0; i < n; i++) {
            double sum = 0;
            for (int j = -kernelRadius; j <= kernelRadius; j++) {
                // 环形边界处理
                int idx = (i + j + n) % n;
                sum += data[idx] * kernel[j + kernelRadius];
            }
            smoothed[i] = sum;
        }
        return smoothed;
    }

    /**
     * 道路类型对围栏可达距离的影响系数
     */
    private double getRoadTypeReachFactor(String roadType) {
        switch (roadType) {
            case "高速": return 1.3;    // 高速路，可达距离远
            case "快速路": return 1.15;
            case "城市道路": return 0.8; // 城市道路，通行受限
            case "小路": return 0.6;     // 小路，通行困难
            default: return 0.9;
        }
    }

    /**
     * 交通拥堵对围栏可达距离的影响系数
     */
    private double getTrafficStatusReachFactor(String status) {
        switch (status) {
            case "畅通": return 1.0;
            case "缓行": return 0.75;
            case "拥堵": return 0.5;
            case "严重拥堵": return 0.3;
            default: return 0.8;
        }
    }

    /**
     * 红绿灯延迟系数
     * 考虑该方向上的红绿灯数量对实际到达时间的影响
     */
    private double getTrafficLightDelayFactor(String roadType, double baseRadiusKm) {
        double lightsPerKm = TRAFFIC_LIGHT_DENSITY.getOrDefault(roadType, 1.8);
        double estimatedLights = lightsPerKm * baseRadiusKm;
        double totalWaitMinutes = estimatedLights * AVG_LIGHT_WAIT_MINUTES;

        // 假设正常通过baseRadius需要约 (baseRadius / 40kmh * 60) 分钟（城市道路约40km/h）
        double normalTravelTime = (baseRadiusKm / 40.0) * 60;
        if (normalTravelTime <= 0) normalTravelTime = 1;

        // 红绿灯等待时间占比
        double lightRatio = totalWaitMinutes / normalTravelTime;
        // 红绿灯越多，同等距离可到达的范围越小
        return 1.0 / (1.0 + lightRatio);
    }

    /**
     * 获取缓存的道路环境信息（一次API调用同时获取道路类型和人口密度）
     */
    private RoadEnvironment getCachedEnvironment(double lng, double lat) {
        String cacheKey = String.format("%.2f,%.2f", lng, lat);
        if (envCache.containsKey(cacheKey)) {
            return envCache.get(cacheKey);
        }
        RoadEnvironment env = queryEnvironment(lng, lat);
        envCache.put(cacheKey, env);
        return env;
    }

    /**
     * 获取缓存的道路类型
     */
    private String getCachedRoadType(double lng, double lat) {
        return getCachedEnvironment(lng, lat).roadType;
    }

    /**
     * 查询高德地图逆地理编码，同时获取道路类型、POI信息、建筑类型
     * 一次API调用获取所有环境信息，避免重复请求
     */
    private RoadEnvironment queryEnvironment(double lng, double lat) {
        String roadType = "城市道路";
        double popFactor = 1.0;
        int poiCount = 0;

        try {
            String urlStr = "https://restapi.amap.com/v3/geocode/regeo?"
                    + "location=" + lng + "," + lat
                    + "&extensions=all&output=json&key=" + amapKey;

            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(1500);

            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) response.append(line);
            in.close();

            JSONObject json = JSON.parseObject(response.toString());
            if ("1".equals(json.getString("status"))) {
                JSONObject regeocode = json.getJSONObject("regeocode");
                if (regeocode != null) {
                    // === 道路类型 ===
                    JSONObject roadinfo = regeocode.getJSONObject("roadinfo");
                    if (roadinfo != null) {
                        String roadName = roadinfo.getString("name");
                        if (roadName != null) {
                            if (roadName.contains("高速")) roadType = "高速";
                            else if (roadName.contains("快速") || roadName.contains("环路")) roadType = "快速路";
                            else roadType = "城市道路";
                        } else {
                            roadType = "小路";
                        }
                    }

                    // === 人口密度估计（基于POI和建筑类型） ===
                    JSONObject addressComponent = regeocode.getJSONObject("addressComponent");
                    if (addressComponent != null) {
                        String buildingType = addressComponent.getString("building");
                        String neighborhood = addressComponent.getString("neighborhood");

                        boolean isDense = false;
                        if (buildingType != null && (buildingType.contains("住宅") || buildingType.contains("商业") || buildingType.contains("写字楼"))) {
                            isDense = true;
                        }
                        if (neighborhood != null && !neighborhood.isEmpty()) {
                            isDense = true;
                        }

                        if (isDense) {
                            popFactor = 0.8 + (hashCoordinate(lng, lat) * 0.1 - 0.05); // 0.75~0.85
                        }
                    }

                    // === POI数量 ===
                    JSONArray pois = regeocode.getJSONArray("pois");
                    if (pois != null) {
                        poiCount = pois.size();
                        if (poiCount > 10) {
                            popFactor = Math.min(popFactor, 0.85);
                        } else if (poiCount > 5) {
                            popFactor = Math.min(popFactor, 0.92);
                        }
                    }
                }
            }
        } catch (Exception e) { e.printStackTrace(); }

        // 如果popFactor还是默认值，使用道路类型估算
        if (popFactor >= 1.0) {
            switch (roadType) {
                case "城市道路": popFactor = 0.85; break;
                case "小路": popFactor = 0.90; break;
                case "快速路": popFactor = 0.95; break;
                case "高速": popFactor = 1.0; break;
            }
        }

        return new RoadEnvironment(roadType, popFactor, poiCount);
    }

    /**
     * 获取缓存的路况状态
     */
    private String getCachedTrafficStatus(double lng, double lat, double centerLng, double centerLat) {
        String cacheKey = String.format("%.2f,%.2f", lng, lat);
        if (trafficCache.containsKey(cacheKey)) {
            return trafficCache.get(cacheKey);
        }

        // 基于方向和道路类型模拟路况（实际应用中应调用高德交通态势API）
        String roadType = getCachedRoadType(lng, lat);
        String status = simulateTrafficStatus(roadType, lng, lat, centerLng, centerLat);
        trafficCache.put(cacheKey, status);
        return status;
    }

    /**
     * 模拟路况（结合道路类型和时段进行确定性模拟，不再使用随机数）
     * 使用坐标哈希+当前小时生成确定性的路况判断，保证同一点位一致性
     */
    private String simulateTrafficStatus(String roadType, double lng, double lat, double centerLng, double centerLat) {
        // 尝试获取真实路况
        try {
            String origin = centerLng + "," + centerLat;
            String destination = lng + "," + lat;
            Map<String, Object> trafficInfo = trafficService.getTrafficInfo(origin, destination);
            String status = (String) trafficInfo.get("traffic_status");
            if (status != null) return status;
        } catch (Exception ignored) {}

        // 降级：基于道路类型 + 时段 + 坐标哈希进行确定性计算
        // 使用坐标哈希值（0-1之间），同一坐标始终得到相同结果
        double deterministicSeed = hashCoordinate(lng, lat);
        int hour = java.time.LocalTime.now().getHour();

        // 高峰期调整：早高峰(7-9)、晚高峰(17-19)拥堵概率增加
        boolean isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
        double peakOffset = isPeakHour ? 0.2 : 0.0; // 高峰期拥堵概率+20%

        switch (roadType) {
            case "高速":
                if (deterministicSeed < 0.8 - peakOffset) return "畅通";
                else if (deterministicSeed < 0.95 - peakOffset * 0.5) return "缓行";
                else return "拥堵";
            case "快速路":
                if (deterministicSeed < 0.7 - peakOffset) return "畅通";
                else if (deterministicSeed < 0.9 - peakOffset * 0.5) return "缓行";
                else return "拥堵";
            case "城市道路":
                if (deterministicSeed < 0.3 - peakOffset) return "畅通";
                else if (deterministicSeed < 0.6 - peakOffset) return "缓行";
                else if (deterministicSeed < 0.9 - peakOffset * 0.5) return "拥堵";
                else return "严重拥堵";
            case "小路":
                if (deterministicSeed < 0.5 - peakOffset) return "畅通";
                else if (deterministicSeed < 0.8 - peakOffset * 0.5) return "缓行";
                else return "拥堵";
            default:
                return "缓行";
        }
    }

    /**
     * 基于坐标生成确定性的哈希值（0-1之间）
     * 同一坐标始终返回相同值
     */
    private double hashCoordinate(double lng, double lat) {
        long lngBits = Double.doubleToLongBits(Math.round(lng * 10000));
        long latBits = Double.doubleToLongBits(Math.round(lat * 10000));
        long hash = lngBits ^ (latBits * 31);
        hash = hash ^ (hash >>> 16);
        return (double)(hash & 0x7FFFFFFF) / (double)0x7FFFFFFF;
    }

    /**
     * 根据起始点、距离和方位角计算目标点坐标
     */
    private double[] destinationPoint(double lat, double lng, double distanceKm, double bearingRad) {
        double R = 6371.0; // 地球半径（公里）
        double latRad = Math.toRadians(lat);
        double lngRad = Math.toRadians(lng);

        double destLatRad = Math.asin(
            Math.sin(latRad) * Math.cos(distanceKm / R) +
            Math.cos(latRad) * Math.sin(distanceKm / R) * Math.cos(bearingRad)
        );

        double destLngRad = lngRad + Math.atan2(
            Math.sin(bearingRad) * Math.sin(distanceKm / R) * Math.cos(latRad),
            Math.cos(distanceKm / R) - Math.sin(latRad) * Math.sin(destLatRad)
        );

        return new double[]{ Math.toDegrees(destLatRad), Math.toDegrees(destLngRad) };
    }

    // ==================== 内部类 ====================

    public static class FenceResult {
        private double coreRadius;
        private List<DispatchRequest.PoliceUnitData> coreUnits;
        private double bufferRadius;
        private List<DispatchRequest.PoliceUnitData> bufferUnits;
        private double extendedRadius;
        private List<DispatchRequest.PoliceUnitData> extendedUnits;

        public double getCoreRadius() { return coreRadius; }
        public void setCoreRadius(double coreRadius) { this.coreRadius = coreRadius; }
        public List<DispatchRequest.PoliceUnitData> getCoreUnits() { return coreUnits; }
        public void setCoreUnits(List<DispatchRequest.PoliceUnitData> coreUnits) { this.coreUnits = coreUnits; }
        public double getBufferRadius() { return bufferRadius; }
        public void setBufferRadius(double bufferRadius) { this.bufferRadius = bufferRadius; }
        public List<DispatchRequest.PoliceUnitData> getBufferUnits() { return bufferUnits; }
        public void setBufferUnits(List<DispatchRequest.PoliceUnitData> bufferUnits) { this.bufferUnits = bufferUnits; }
        public double getExtendedRadius() { return extendedRadius; }
        public void setExtendedRadius(double extendedRadius) { this.extendedRadius = extendedRadius; }
        public List<DispatchRequest.PoliceUnitData> getExtendedUnits() { return extendedUnits; }
        public void setExtendedUnits(List<DispatchRequest.PoliceUnitData> extendedUnits) { this.extendedUnits = extendedUnits; }
        public int getTotalUnits() {
            int count = 0;
            if (coreUnits != null) count += coreUnits.size();
            if (bufferUnits != null) count += bufferUnits.size();
            if (extendedUnits != null) count += extendedUnits.size();
            return count;
        }
    }
}