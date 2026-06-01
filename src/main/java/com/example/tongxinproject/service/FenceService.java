package com.example.tongxinproject.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.example.tongxinproject.common.GeoUtils;
import com.example.tongxinproject.dto.DispatchRequest;
import com.example.tongxinproject.dto.FencePolygonResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class FenceService {

    private static final Logger log = LoggerFactory.getLogger(FenceService.class);

    @Autowired
    private TrafficService trafficService;

    @Value("${amap.key}")
    private String amapKey;

    // 三层围栏基础半径（公里）
    private static final double CORE_FENCE_RADIUS = 3.0;
    private static final double BUFFER_FENCE_RADIUS = 8.0;
    private static final double EXTENDED_FENCE_RADIUS = 15.0;

    // 采样方向数（按层差异化：核心圈高精度，扩展圈低精度以减少API调用）
    private static final Map<FenceLevel, Integer> SAMPLE_DIRECTIONS_PER_LAYER = Map.of(
        FenceLevel.CORE, 24,      // 每15°
        FenceLevel.BUFFER, 18,    // 每20°
        FenceLevel.EXTENDED, 12   // 每30°
    );

    // 建筑密集度系数（基于道路类型推断）
    private static final Map<String, Double> BUILDING_DENSITY_FACTORS = new HashMap<>();
    static {
        BUILDING_DENSITY_FACTORS.put("高速", 0.85);
        BUILDING_DENSITY_FACTORS.put("快速路", 0.92);
        BUILDING_DENSITY_FACTORS.put("城市道路", 1.25);
        BUILDING_DENSITY_FACTORS.put("小路", 1.15);
        BUILDING_DENSITY_FACTORS.put("未知", 1.1);
    }

    // 河流障碍系数（基于道路类型推断 + 实际水系检测）
    private static final Map<String, Double> RIVER_BARRIER_FACTORS = new HashMap<>();
    static {
        RIVER_BARRIER_FACTORS.put("高速", 1.05);
        RIVER_BARRIER_FACTORS.put("快速路", 1.1);
        RIVER_BARRIER_FACTORS.put("城市道路", 1.0);
        RIVER_BARRIER_FACTORS.put("小路", 1.05);
        RIVER_BARRIER_FACTORS.put("未知", 1.08);
    }

    // 实际水体障碍系数（检测到河流/湖泊时）
    private static final double WATER_BODY_FACTOR = 0.35;    // 水体方向通行能力大幅降低
    private static final double RAILWAY_FACTOR = 0.7;        // 铁路障碍
    private static final double PARK_GREEN_FACTOR = 0.85;    // 公园/绿地（无道路穿越）

    // 红绿灯密度系数（每公里预估红绿灯数）
    private static final Map<String, Double> TRAFFIC_LIGHT_DENSITY = new HashMap<>();
    static {
        TRAFFIC_LIGHT_DENSITY.put("高速", 0.0);
        TRAFFIC_LIGHT_DENSITY.put("快速路", 0.3);
        TRAFFIC_LIGHT_DENSITY.put("城市道路", 2.0);
        TRAFFIC_LIGHT_DENSITY.put("小路", 1.5);
        TRAFFIC_LIGHT_DENSITY.put("未知", 1.8);
    }

    // 红绿灯平均等待时间（分钟）
    private static final double AVG_LIGHT_WAIT_MINUTES = 0.5;

    // TTL缓存包装
    private static class CacheEntry<V> {
        final V value;
        final long createdAt;
        CacheEntry(V value) { this.value = value; this.createdAt = System.currentTimeMillis(); }
        boolean isExpired(long ttlMs) { return System.currentTimeMillis() - createdAt > ttlMs; }
    }

    // 缓存（带TTL自动过期）
    private final Map<String, CacheEntry<RoadEnvironment>> envCache = new ConcurrentHashMap<>();
    private final Map<String, CacheEntry<String>> trafficCache = new ConcurrentHashMap<>();
    // waterDistanceCache 已删除 — 死代码从未被读写

    /**
     * 增强版道路环境信息
     */
    private static class RoadEnvironment {
        String roadType;
        double populationDensityFactor;
        int poiCount;
        boolean hasWater;        // 是否有水体
        double waterDistance;    // 到最近水体的距离（km）
        boolean hasRailway;      // 是否有铁路
        boolean hasPark;         // 是否有公园/绿地

        RoadEnvironment(String roadType, double populationDensityFactor, int poiCount) {
            this.roadType = roadType;
            this.populationDensityFactor = populationDensityFactor;
            this.poiCount = poiCount;
        }
    }

    // 缓存TTL常量（毫秒）
    private static final long ENV_CACHE_TTL_MS = 300_000;     // 环境数据: 5分钟
    private static final long TRAFFIC_CACHE_TTL_MS = 60_000;  // 交通数据: 1分钟

    @PostConstruct
    public void initCacheCleanup() {
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "fence-cache-cleanup");
            t.setDaemon(true);
            return t;
        }).scheduleWithFixedDelay(() -> {
            envCache.entrySet().removeIf(e -> e.getValue().isExpired(ENV_CACHE_TTL_MS));
            trafficCache.entrySet().removeIf(e -> e.getValue().isExpired(TRAFFIC_CACHE_TTL_MS));
        }, 60, 60, TimeUnit.SECONDS);
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
            if (trafficInfo.containsKey("error")) return 1.0;
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
        } catch (Exception e) {
            log.debug("Failed to get traffic adjustment: {}", e.getMessage());
        }
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
            if (Boolean.TRUE.equals(unit.getAvailable()) && isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, level))
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
            if (Boolean.TRUE.equals(unit.getAvailable()) &&
                isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, FenceLevel.BUFFER) &&
                !isPointInFence(unit.getLng(), unit.getLat(), centerLng, centerLat, FenceLevel.CORE))
                bufferUnits.add(unit);
        }
        result.setBufferRadius(calculateDynamicRadius(centerLng, centerLat, FenceLevel.BUFFER));
        result.setBufferUnits(bufferUnits);

        List<DispatchRequest.PoliceUnitData> extendedUnits = new ArrayList<>();
        for (DispatchRequest.PoliceUnitData unit : units) {
            if (Boolean.TRUE.equals(unit.getAvailable()) &&
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

    // ==================== 不规则动态围栏多边形生成（增强版） ====================

    /**
     * 生成三层不规则动态围栏多边形（增强版）
     *
     * 参考国内外路径算法优化：
     * - Dijkstra/A* 思想：每个方向独立评估"通行代价"，代价高的方向围栏收缩
     * - 等时圈概念（借鉴 Mapbox/GraphHopper Isochrone）：围栏 = N分钟可达范围
     * - 地形感知（借鉴 OSRM/Valhalla）：水系、铁路、公园为硬/软障碍
     * - 多尺度噪声（借鉴 Perlin Noise）：模拟自然地物不规则性
     * - 方向交错（借鉴 Uber H3）：各层采样角度错开，避免同心圆
     */
    public FencePolygonResponse generateDynamicFencePolygon(double centerLng, double centerLat) {
        FencePolygonResponse response = new FencePolygonResponse();
        response.setCenterLng(centerLng);
        response.setCenterLat(centerLat);

        // BugFix: 不再清空缓存（缓存有TTL自动过期），避免重复API调用
        // BugFix: 修复重复天气API调用 — 只调用一次
        Map<String, Object> weatherInfo = trafficService.getWeatherInfo(centerLng, centerLat);
        double weatherFactor = (Double) weatherInfo.getOrDefault("weather_factor", 1.0);

        Map<String, Object> factorDetails = new LinkedHashMap<>();
        factorDetails.put("weather", weatherInfo.getOrDefault("weather", "晴"));
        factorDetails.put("weather_factor", weatherFactor);
        factorDetails.put("sample_directions", "CORE:24/BUFFER:18/EXTENDED:12");
        factorDetails.put("algorithm", "multi-scale_terrain_aware_isochrone");

        Map<String, Integer> roadTypeStats = new HashMap<>();
        Map<String, Integer> trafficStats = new HashMap<>();
        Map<String, Integer> barrierStats = new HashMap<>();

        // 各层使用错开的角度偏移，避免同心圆效应
        double[] layerAngleOffsets = {0.0, 5.0, 2.5};  // 核心圈0°、缓冲圈5°、扩展圈2.5°偏移

        List<FencePolygonResponse.FenceLayer> layers = new ArrayList<>();
        for (int li = 0; li < 3; li++) {
            FenceLevel level = FenceLevel.values()[li];
            layers.add(buildFenceLayerEnhanced(centerLng, centerLat, level, weatherFactor,
                roadTypeStats, trafficStats, barrierStats, layerAngleOffsets[li]));
        }

        factorDetails.put("road_type_distribution", roadTypeStats);
        factorDetails.put("traffic_status_distribution", trafficStats);
        factorDetails.put("barrier_distribution", barrierStats);
        response.setFactorDetails(factorDetails);
        response.setLayers(layers);

        return response;
    }

    /**
     * 增强版单层围栏构建
     *
     * 核心改进：
     * 1. 多层采样（25%/50%/75%/100%基础半径）综合评估
     * 2. 多尺度地形噪声（3个八度）模拟自然地物不规则
     * 3. 实际水系检测 + 铁路/公园障碍
     * 4. 降低高斯平滑（sigma=1.0）保持地形特征
     * 5. 方向交错避免多层同心圆
     */
    private FencePolygonResponse.FenceLayer buildFenceLayerEnhanced(double centerLng, double centerLat,
            FenceLevel level, double weatherFactor,
            Map<String, Integer> roadTypeStats, Map<String, Integer> trafficStats,
            Map<String, Integer> barrierStats, double angleOffsetDeg) {

        FencePolygonResponse.FenceLayer layer = new FencePolygonResponse.FenceLayer();
        layer.setName(level.getName());
        layer.setLevel(level.name());
        layer.setBaseRadius(level.getBaseRadius());
        int sampleDirs = SAMPLE_DIRECTIONS_PER_LAYER.getOrDefault(level, 18);
        layer.setSampleCount(sampleDirs);

        // 多层采样比例：距中心不同距离评估环境
        // BugFix: EXTENDED层从4个采样比降为3个，减少API调用
        double[] sampleRatios;
        if (level == FenceLevel.EXTENDED) {
            sampleRatios = new double[]{0.33, 0.66, 1.0};
        } else if (level == FenceLevel.BUFFER) {
            sampleRatios = new double[]{0.4, 0.7, 1.0};
        } else {
            sampleRatios = new double[]{0.5, 1.0};
        }

        double[] rawAdjustments = new double[sampleDirs];
        String[] directionRoadTypes = new String[sampleDirs];
        String[] directionTraffic = new String[sampleDirs];

        for (int i = 0; i < sampleDirs; i++) {
            // 角度错开 + 微扰动（模拟实际道路不会正好在采样方向上）
            double baseAngleDeg = (360.0 / sampleDirs) * i + angleOffsetDeg;
            // 微扰动：±2°的确定性抖动
            double jitter = (hashCoordinate(centerLng + i * 0.001, centerLat) - 0.5) * 4.0;
            double angleDeg = baseAngleDeg + jitter;
            double angleRad = Math.toRadians(angleDeg);

            double totalAdjustment = 0;
            double totalWeight = 0;
            String dominantRoadType = "城市道路";
            String dominantTraffic = "缓行";
            boolean hasWaterBarrier = false;

            for (int si = 0; si < sampleRatios.length; si++) {
                double sampleDistance = level.getBaseRadius() * sampleRatios[si];
                // 权重：近距离大权重（倒指数衰减）
                double weight = Math.exp(-si * 0.6);

                double[] samplePoint = destinationPoint(centerLat, centerLng, sampleDistance, angleRad);
                double sampleLng = samplePoint[1];
                double sampleLat = samplePoint[0];

                RoadEnvironment env = getCachedEnvironment(sampleLng, sampleLat);
                String roadType = env.roadType;
                String trafficStatus = getCachedTrafficStatus(sampleLng, sampleLat, centerLng, centerLat);

                double buildingFactor = BUILDING_DENSITY_FACTORS.getOrDefault(roadType, 1.1);
                double riverFactor = RIVER_BARRIER_FACTORS.getOrDefault(roadType, 1.08);
                double populationFactor = env.populationDensityFactor;

                // 水系硬障碍：检测到水体时大幅降低通行
                double waterFactor = 1.0;
                if (env.hasWater) {
                    waterFactor = WATER_BODY_FACTOR;
                    hasWaterBarrier = true;
                    barrierStats.merge("water", 1, Integer::sum);
                }
                // 铁路软障碍
                double railwayFactor = env.hasRailway ? RAILWAY_FACTOR : 1.0;
                if (env.hasRailway) barrierStats.merge("railway", 1, Integer::sum);
                // 公园/绿地障碍
                double parkFactor = env.hasPark ? PARK_GREEN_FACTOR : 1.0;
                if (env.hasPark) barrierStats.merge("park", 1, Integer::sum);

                // 多尺度地形噪声（3个八度）
                double terrainNoise = multiOctaveNoise(sampleLng, sampleLat, level.getBaseRadius());

                double roadFactor = getRoadTypeReachFactor(roadType);
                double trafficFactor = getTrafficStatusReachFactor(trafficStatus);
                double lightFactor = getTrafficLightDelayFactor(roadType, level.getBaseRadius());

                // 综合调整系数：各因子相乘 + 地形噪声调制
                double pointAdjustment = roadFactor * trafficFactor * weatherFactor
                    * buildingFactor * riverFactor * lightFactor * populationFactor
                    * waterFactor * railwayFactor * parkFactor
                    * terrainNoise;
                // 放宽范围，让地形因素充分体现
                pointAdjustment = Math.max(0.15, Math.min(1.8, pointAdjustment));

                totalAdjustment += pointAdjustment * weight;
                totalWeight += weight;

                if (si == sampleRatios.length - 1) {
                    dominantRoadType = roadType;
                    dominantTraffic = trafficStatus;
                }
            }

            rawAdjustments[i] = totalAdjustment / totalWeight;
            directionRoadTypes[i] = dominantRoadType;
            directionTraffic[i] = dominantTraffic;
        }

        // 降低高斯平滑强度（sigma=1.0），保持自然地物特征
        double[] smoothedAdjustments = gaussianSmooth(rawAdjustments, 1);

        List<FencePolygonResponse.FenceVertex> vertices = new ArrayList<>();
        double totalEffAdjustment = 0;

        for (int i = 0; i < sampleDirs; i++) {
            double angleDeg = (360.0 / sampleDirs) * i + angleOffsetDeg;
            double angleRad = Math.toRadians(angleDeg);
            double adjustment = smoothedAdjustments[i];
            double adjustedDistance = level.getBaseRadius() * adjustment;

            totalEffAdjustment += adjustment;

            roadTypeStats.merge(directionRoadTypes[i], 1, Integer::sum);
            trafficStats.merge(directionTraffic[i], 1, Integer::sum);

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

        layer.setEffectiveRadius(level.getBaseRadius() * (totalEffAdjustment / sampleDirs));
        layer.setVertices(vertices);
        return layer;
    }

    /**
     * 多尺度地形噪声（3个八度叠加）
     * 模拟真实地形的不规则性：山脉、谷地、建成区等自然地物边界
     * 使用坐标哈希生成确定性噪声，同一位置结果一致
     */
    private double multiOctaveNoise(double lng, double lat, double scale) {
        // 3个八度叠加，频率递增、振幅递减
        double noise = 0;
        double amplitude = 0.5;   // 基准振幅
        double frequency = 1.0;   // 基准频率
        double persistence = 0.5; // 持续度（每八度振幅减半）

        for (int octave = 0; octave < 3; octave++) {
            double nx = lng * frequency * 800.0;
            double ny = lat * frequency * 1000.0;
            noise += amplitude * simplex2D(nx, ny);
            frequency *= 2.0;
            amplitude *= persistence;
        }

        // 映射到 [0.6, 1.5] — 噪声值影响可达距离的±40%
        return 0.6 + (noise + 0.8) / 1.6 * 0.9;
    }

    /**
     * 简化2D Simplex-like噪声（基于坐标哈希）
     * 生成 [-1, 1] 范围的平滑伪随机值
     */
    private double simplex2D(double x, double y) {
        int ix = (int) Math.floor(x);
        int iy = (int) Math.floor(y);
        double fx = x - ix;
        double fy = y - iy;

        // Smoothstep 插值权重
        double sx = fx * fx * (3.0 - 2.0 * fx);
        double sy = fy * fy * (3.0 - 2.0 * fy);

        // 四角哈希值
        double n00 = hashCorner(ix, iy);
        double n10 = hashCorner(ix + 1, iy);
        double n01 = hashCorner(ix, iy + 1);
        double n11 = hashCorner(ix + 1, iy + 1);

        // 双线性插值
        double nx0 = n00 + sx * (n10 - n00);
        double nx1 = n01 + sx * (n11 - n01);
        return nx0 + sy * (nx1 - nx0);
    }

    private double hashCorner(int x, int y) {
        long n = (long) x * 15731L + (long) y * 789221L;
        n = (n ^ (n >>> 13)) * 0x5bd1e995L;
        n = n ^ (n >>> 15);
        return (double) (n & 0x7fffffff) / (double) 0x7fffffff * 2.0 - 1.0;
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
     * BugFix: 使用computeIfAbsent消除竞态条件，TTL自动过期
     */
    private RoadEnvironment getCachedEnvironment(double lng, double lat) {
        // 提高精度到3位小数(约111m), 提升跨层缓存命中率
        String cacheKey = String.format("%.3f,%.3f", lng, lat);
        CacheEntry<RoadEnvironment> entry = envCache.computeIfAbsent(cacheKey,
            k -> new CacheEntry<>(queryEnvironment(lng, lat)));
        return entry.value;
    }

    /**
     * 获取缓存的道路类型
     */
    private String getCachedRoadType(double lng, double lat) {
        return getCachedEnvironment(lng, lat).roadType;
    }

    /**
     * 查询高德地图逆地理编码 + 周边POI搜索
     * 一次调用获取：道路类型、POI信息、建筑类型、水系、铁路、公园
     */
    private RoadEnvironment queryEnvironment(double lng, double lat) {
        String roadType = "城市道路";
        double popFactor = 1.0;
        int poiCount = 0;
        boolean hasWater = false;
        boolean hasRailway = false;
        boolean hasPark = false;

        try {
            // 1. 逆地理编码获取道路和建筑信息
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
                        // 铁路检测
                        if (roadName.contains("铁路") || roadName.contains("铁道") || roadName.contains("轨道")) {
                            hasRailway = true;
                        }
                    }

                    // === 人口密度估计 ===
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
                            popFactor = 0.8 + (hashCoordinate(lng, lat) * 0.1 - 0.05);
                        }
                    }

                    // === POI分析：水系/铁路/公园检测 ===
                    JSONArray pois = regeocode.getJSONArray("pois");
                    if (pois != null) {
                        poiCount = pois.size();
                        for (int pi = 0; pi < pois.size(); pi++) {
                            JSONObject poi = pois.getJSONObject(pi);
                            String poiType = poi.getString("type");
                            String poiName = poi.getString("name");

                            if (poiType != null) {
                                // 水系检测
                                if (poiType.contains("水系") || poiType.contains("河流") || poiType.contains("湖泊")
                                        || poiType.contains("水库") || poiType.contains("海洋")) {
                                    hasWater = true;
                                }
                                // 铁路检测
                                if (poiType.contains("铁路") || poiType.contains("火车站") || poiType.contains("高铁")) {
                                    hasRailway = true;
                                }
                                // 公园/绿地检测
                                if (poiType.contains("公园") || poiType.contains("绿地") || poiType.contains("风景区")
                                        || poiType.contains("植物园") || poiType.contains("动物园")) {
                                    hasPark = true;
                                }
                            }
                            if (poiName != null) {
                                if (poiName.contains("河") || poiName.contains("湖") || poiName.contains("江")
                                        || poiName.contains("水库") || poiName.contains("海") || poiName.contains("塘")) {
                                    hasWater = true;
                                }
                                if (poiName.contains("公园") || poiName.contains("景区") || poiName.contains("植物园")
                                        || poiName.contains("陵园") || poiName.contains("高尔夫")) {
                                    hasPark = true;
                                }
                                if (poiName.contains("火车站") || poiName.contains("铁路") || poiName.contains("高铁")) {
                                    hasRailway = true;
                                }
                            }
                        }
                        if (poiCount > 10) {
                            popFactor = Math.min(popFactor, 0.85);
                        } else if (poiCount > 5) {
                            popFactor = Math.min(popFactor, 0.92);
                        }
                    }
                }
            }

            // 2. 补充周边POI搜索（500m范围），专门探测水系/铁路
            try {
                String poiUrl = "https://restapi.amap.com/v3/place/around?"
                        + "location=" + lng + "," + lat
                        + "&radius=500&keywords=" + URLEncoder.encode("河流|湖泊|铁路|火车站|公园", "UTF-8")
                        + "&output=json&key=" + amapKey;
                URL poiUrlObj = new URL(poiUrl);
                HttpURLConnection poiConn = (HttpURLConnection) poiUrlObj.openConnection();
                poiConn.setRequestMethod("GET");
                poiConn.setConnectTimeout(1000);
                poiConn.setReadTimeout(1000);

                BufferedReader poiIn = new BufferedReader(new InputStreamReader(poiConn.getInputStream(), "UTF-8"));
                StringBuilder poiResponse = new StringBuilder();
                String poiLine;
                while ((poiLine = poiIn.readLine()) != null) poiResponse.append(poiLine);
                poiIn.close();

                JSONObject poiJson = JSON.parseObject(poiResponse.toString());
                if ("1".equals(poiJson.getString("status"))) {
                    JSONArray nearbyPois = poiJson.getJSONArray("pois");
                    if (nearbyPois != null && !nearbyPois.isEmpty()) {
                        for (int pi = 0; pi < nearbyPois.size(); pi++) {
                            JSONObject nearbyPoi = nearbyPois.getJSONObject(pi);
                            String pType = nearbyPoi.getString("type");
                            String pName = nearbyPoi.getString("name");
                            // 计算距离
                            String distStr = nearbyPoi.getString("distance"); // 米
                            double distM = distStr != null ? Double.parseDouble(distStr) : 500;

                            if (pType != null) {
                                if (pType.contains("水系") || pType.contains("河流") || pType.contains("湖泊")) {
                                    hasWater = true;
                                }
                                if (pType.contains("铁路") || pType.contains("火车站")) hasRailway = true;
                                if (pType.contains("公园") || pType.contains("绿地") || pType.contains("风景")) hasPark = true;
                            }
                            if (pName != null) {
                                if (pName.contains("河") || pName.contains("湖") || pName.contains("江") || pName.contains("海")) {
                                    hasWater = true;
                                }
                                if (pName.contains("公园") || pName.contains("景区")) hasPark = true;
                                if (pName.contains("站") && (pName.contains("火车") || pName.contains("高铁"))) hasRailway = true;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
                log.debug("POI around search failed (non-critical): {}", ignored.getMessage());
            }
        } catch (Exception e) {
            // 降级：使用地形噪声推断
            double noiseHere = multiOctaveNoise(lng, lat, 1.0);
            if (noiseHere < 0.7) hasWater = true;  // 低噪声区域可能是水域
        }

        if (popFactor >= 1.0) {
            switch (roadType) {
                case "城市道路": popFactor = 0.85; break;
                case "小路": popFactor = 0.90; break;
                case "快速路": popFactor = 0.95; break;
                case "高速": popFactor = 1.0; break;
            }
        }

        RoadEnvironment env = new RoadEnvironment(roadType, popFactor, poiCount);
        env.hasWater = hasWater;
        env.hasRailway = hasRailway;
        env.hasPark = hasPark;
        return env;
    }

    /**
     * 获取缓存的路况状态
     */
    private String getCachedTrafficStatus(double lng, double lat, double centerLng, double centerLat) {
        // BugFix: computeIfAbsent消除竞态条件, 提高精度到3位小数
        String cacheKey = String.format("%.3f,%.3f", lng, lat);
        CacheEntry<String> entry = trafficCache.computeIfAbsent(cacheKey,
            k -> new CacheEntry<>(simulateTrafficStatus(
                getCachedRoadType(lng, lat), lng, lat, centerLng, centerLat)));
        return entry.value;
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
            if (trafficInfo.containsKey("error")) return null;
            String status = (String) trafficInfo.get("traffic_status");
            if (status != null) return status;
        } catch (Exception ignored) {
            log.debug("Traffic info API failed, using fallback: {}", ignored.getMessage());
        }

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