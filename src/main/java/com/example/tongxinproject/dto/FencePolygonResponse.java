package com.example.tongxinproject.dto;

import java.util.List;
import java.util.Map;

/**
 * 动态围栏多边形响应
 */
public class FencePolygonResponse {
    
    private double centerLng;
    private double centerLat;
    
    // 综合影响因素
    private Map<String, Object> factorDetails;
    
    // 三层围栏多边形顶点
    private List<FenceLayer> layers;

    public double getCenterLng() { return centerLng; }
    public void setCenterLng(double centerLng) { this.centerLng = centerLng; }
    public double getCenterLat() { return centerLat; }
    public void setCenterLat(double centerLat) { this.centerLat = centerLat; }
    public Map<String, Object> getFactorDetails() { return factorDetails; }
    public void setFactorDetails(Map<String, Object> factorDetails) { this.factorDetails = factorDetails; }
    public List<FenceLayer> getLayers() { return layers; }
    public void setLayers(List<FenceLayer> layers) { this.layers = layers; }

    /**
     * 单层围栏数据
     */
    public static class FenceLayer {
        private String name;
        private String level;       // CORE / BUFFER / EXTENDED
        private double baseRadius;  // 基础半径（公里）
        private double effectiveRadius; // 平均有效半径（公里）
        private int sampleCount;    // 采样点数
        private List<FenceVertex> vertices; // 不规则多边形顶点

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getLevel() { return level; }
        public void setLevel(String level) { this.level = level; }
        public double getBaseRadius() { return baseRadius; }
        public void setBaseRadius(double baseRadius) { this.baseRadius = baseRadius; }
        public double getEffectiveRadius() { return effectiveRadius; }
        public void setEffectiveRadius(double effectiveRadius) { this.effectiveRadius = effectiveRadius; }
        public int getSampleCount() { return sampleCount; }
        public void setSampleCount(int sampleCount) { this.sampleCount = sampleCount; }
        public List<FenceVertex> getVertices() { return vertices; }
        public void setVertices(List<FenceVertex> vertices) { this.vertices = vertices; }
    }

    /**
     * 围栏顶点（经纬度坐标）
     */
    public static class FenceVertex {
        private double lng;
        private double lat;
        private double distanceKm;     // 距中心点距离（公里）
        private double adjustment;     // 综合调整系数
        private String roadType;       // 该方向上的道路类型
        private String trafficStatus;  // 该方向上的路况状态

        public double getLng() { return lng; }
        public void setLng(double lng) { this.lng = lng; }
        public double getLat() { return lat; }
        public void setLat(double lat) { this.lat = lat; }
        public double getDistanceKm() { return distanceKm; }
        public void setDistanceKm(double distanceKm) { this.distanceKm = distanceKm; }
        public double getAdjustment() { return adjustment; }
        public void setAdjustment(double adjustment) { this.adjustment = adjustment; }
        public String getRoadType() { return roadType; }
        public void setRoadType(String roadType) { this.roadType = roadType; }
        public String getTrafficStatus() { return trafficStatus; }
        public void setTrafficStatus(String trafficStatus) { this.trafficStatus = trafficStatus; }
    }
}