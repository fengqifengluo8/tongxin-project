package com.example.tongxinproject.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class TrafficService {

    private static final Logger log = LoggerFactory.getLogger(TrafficService.class);

    @Value("${amap.key}")
    private String amapKey;

    @Value("${amap.sec}")
    private String amapSecurityKey;

    // 不同道路类型的基础速度（公里/小时）
    private static final Map<String, Double> ROAD_TYPE_SPEEDS = new HashMap<>();
    static {
        ROAD_TYPE_SPEEDS.put("高速", 80.0);
        ROAD_TYPE_SPEEDS.put("快速路", 60.0);
        ROAD_TYPE_SPEEDS.put("城市道路", 40.0);
        ROAD_TYPE_SPEEDS.put("小路", 20.0);
    }

    // 不同时段的速度调整系数
    private static final Map<String, Double> TIME_PERIOD_FACTORS = new HashMap<>();
    static {
        TIME_PERIOD_FACTORS.put("早高峰", 0.6);  // 7:00-9:00
        TIME_PERIOD_FACTORS.put("晚高峰", 0.6);  // 17:00-19:00
        TIME_PERIOD_FACTORS.put("平峰", 1.0);    // 其他时段
    }

    // 不同天气类型的速度调整系数
    private static final Map<String, Double> WEATHER_FACTORS = new HashMap<>();
    static {
        WEATHER_FACTORS.put("晴", 1.0);
        WEATHER_FACTORS.put("多云", 0.95);
        WEATHER_FACTORS.put("阴", 0.9);
        WEATHER_FACTORS.put("小雨", 0.8);
        WEATHER_FACTORS.put("中雨", 0.65);
        WEATHER_FACTORS.put("大雨", 0.5);
        WEATHER_FACTORS.put("暴雨", 0.4);
        WEATHER_FACTORS.put("小雪", 0.7);
        WEATHER_FACTORS.put("中雪", 0.5);
        WEATHER_FACTORS.put("大雪", 0.35);
        WEATHER_FACTORS.put("暴雪", 0.25);
        WEATHER_FACTORS.put("雾", 0.5);
        WEATHER_FACTORS.put("霾", 0.6);
        WEATHER_FACTORS.put("大风", 0.7);
        WEATHER_FACTORS.put("沙尘", 0.6);
    }

    // 红绿灯平均等待时间（秒）
    private static final double AVG_TRAFFIC_LIGHT_WAIT = 30.0;

    /**
     * 获取实时交通拥堵信息（包含红绿灯数量）
     * @param origin 起点坐标（lng,lat）
     * @param destination 终点坐标（lng,lat）
     * @return 拥堵信息
     */
    public Map<String, Object> getTrafficInfo(String origin, String destination) {
        Map<String, Object> result = new HashMap<>();
        try {
            String urlStr = "https://restapi.amap.com/v3/direction/driving?"
                    + "origin=" + URLEncoder.encode(origin, "UTF-8")
                    + "&destination=" + URLEncoder.encode(destination, "UTF-8")
                    + "&extensions=all"
                    + "&output=json"
                    + "&key=" + amapKey;

            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) {
                response.append(line);
            }
            in.close();

            JSONObject json = JSON.parseObject(response.toString());
            if ("1".equals(json.getString("status"))) {
                JSONObject route = json.getJSONObject("route");
                if (route == null) return result;
                JSONArray paths = route.getJSONArray("paths");
                if (paths != null && !paths.isEmpty()) {
                    JSONObject path = paths.getJSONObject(0);
                    result.put("distance", path.getDouble("distance"));
                    result.put("duration", path.getDouble("duration"));
                    result.put("traffic_status", path.getString("traffic_status"));
                    result.put("congestion_distance", path.getDouble("congestion_distance"));
                    
                    // 计算红绿灯数量
                    int trafficLightCount = estimateTrafficLightCount(path);
                    result.put("traffic_light_count", trafficLightCount);
                    result.put("traffic_light_wait_time", trafficLightCount * AVG_TRAFFIC_LIGHT_WAIT);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to get traffic info: {}", e.getMessage());
            result.put("error", "traffic_service_unavailable");
        }
        return result;
    }

    /**
     * 估算路径中的红绿灯数量
     * @param path 路径信息
     * @return 红绿灯数量
     */
    private int estimateTrafficLightCount(JSONObject path) {
        int count = 0;
        try {
            JSONArray steps = path.getJSONArray("steps");
            if (steps != null) {
                for (int i = 0; i < steps.size(); i++) {
                    JSONObject step = steps.getJSONObject(i);
                    String roadType = step.getString("road_type");
                    // 城市道路和小路通常有红绿灯，高速和快速路较少
                    if (roadType != null && (roadType.equals("城市道路") || roadType.equals("小路"))) {
                        double distance = step.getDouble("distance");
                        // 每500米估算一个红绿灯
                        count += (int) (distance / 500);
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Failed to estimate traffic light count: {}", e.getMessage());
        }
        return Math.max(count, 0);
    }

    /**
     * 获取道路类型信息
     * @param lng 经度
     * @param lat 纬度
     * @return 道路类型
     */
    public String getRoadType(double lng, double lat) {
        try {
            String urlStr = "https://restapi.amap.com/v3/geocode/regeo?"
                    + "location=" + lng + "," + lat
                    + "&extensions=all"
                    + "&output=json"
                    + "&key=" + amapKey;

            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) {
                response.append(line);
            }
            in.close();

            JSONObject json = JSON.parseObject(response.toString());
            if ("1".equals(json.getString("status"))) {
                JSONObject regeocode = json.getJSONObject("regeocode");
                if (regeocode != null) {
                    JSONObject roadinfo = regeocode.getJSONObject("roadinfo");
                    if (roadinfo != null) {
                        String roadName = roadinfo.getString("name");
                        if (roadName != null) {
                            if (roadName.contains("高速") || roadName.contains("高速路")) {
                                return "高速";
                            } else if (roadName.contains("快速") || roadName.contains("环路")) {
                                return "快速路";
                            }
                            return "城市道路";
                        }
                        return "小路";
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Failed to get road type: {}", e.getMessage());
        }
        return "城市道路";
    }

    /**
     * 获取当前时段的速度调整系数
     * @return 调整系数
     */
    public double getTimePeriodFactor() {
        int hour = java.time.LocalTime.now().getHour();
        if (hour >= 7 && hour < 9) {
            return TIME_PERIOD_FACTORS.get("早高峰");
        } else if (hour >= 17 && hour < 19) {
            return TIME_PERIOD_FACTORS.get("晚高峰");
        } else {
            return TIME_PERIOD_FACTORS.get("平峰");
        }
    }

    /**
     * 获取指定位置的天气状况
     * @param lng 经度
     * @param lat 纬度
     * @return 天气信息
     */
    public Map<String, Object> getWeatherInfo(double lng, double lat) {
        Map<String, Object> result = new HashMap<>();
        try {
            String urlStr = "https://restapi.amap.com/v3/weather/weatherInfo?"
                    + "city=" + getCityCode(lng, lat)
                    + "&extensions=base"
                    + "&output=json"
                    + "&key=" + amapKey;

            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) {
                response.append(line);
            }
            in.close();

            JSONObject json = JSON.parseObject(response.toString());
            if ("1".equals(json.getString("status"))) {
                JSONArray lives = json.getJSONArray("lives");
                if (!lives.isEmpty()) {
                    JSONObject live = lives.getJSONObject(0);
                    String weather = live.getString("weather");
                    String temperature = live.getString("temperature");
                    String windSpeed = live.getString("wind_speed");
                    
                    result.put("weather", weather);
                    result.put("temperature", temperature);
                    result.put("wind_speed", windSpeed);
                    result.put("weather_factor", getWeatherFactor(weather));
                }
            }
        } catch (Exception e) {
            log.warn("Failed to get weather info: {}", e.getMessage());
            result.put("weather", "晴");
            result.put("weather_factor", 1.0);
        }
        return result;
    }

    private static final Map<String, double[]> CITY_BOUNDS = new LinkedHashMap<>();
    static {
        // 武汉及周边城市粗粒度包围盒（格式：{minLng, maxLng, minLat, maxLat}）
        CITY_BOUNDS.put("420100", new double[]{113.68, 115.08, 29.97, 31.37}); // 武汉
        CITY_BOUNDS.put("110000", new double[]{115.42, 117.50, 39.44, 41.06}); // 北京
        CITY_BOUNDS.put("310000", new double[]{120.84, 122.00, 30.67, 31.53}); // 上海
        CITY_BOUNDS.put("440100", new double[]{112.95, 114.05, 22.55, 23.93}); // 广州
        CITY_BOUNDS.put("440300", new double[]{113.75, 114.62, 22.45, 22.86}); // 深圳
        CITY_BOUNDS.put("510100", new double[]{103.01, 104.90, 30.08, 31.43}); // 成都
        CITY_BOUNDS.put("500000", new double[]{105.29, 110.20, 28.17, 32.20}); // 重庆
    }

    /**
     * 基于坐标的粗粒度城市编码查找（包围盒法）
     * 未命中时返回 "420100"（武汉），覆盖本项目主要使用场景
     */
    private String getCityCode(double lng, double lat) {
        for (Map.Entry<String, double[]> entry : CITY_BOUNDS.entrySet()) {
            double[] b = entry.getValue();
            if (lng >= b[0] && lng <= b[1] && lat >= b[2] && lat <= b[3]) {
                return entry.getKey();
            }
        }
        return "420100"; // 默认武汉，覆盖本项目主场景
    }

    /**
     * 根据天气类型获取速度调整系数
     * @param weather 天气类型
     * @return 调整系数
     */
    public double getWeatherFactor(String weather) {
        if (weather == null || weather.isEmpty()) {
            return 1.0;
        }
        for (Map.Entry<String, Double> entry : WEATHER_FACTORS.entrySet()) {
            if (weather.contains(entry.getKey())) {
                return entry.getValue();
            }
        }
        return 1.0;
    }

    /**
     * 根据交通方式、道路类型、时段和天气计算实际速度
     * @param transportMode 交通方式
     * @param roadType 道路类型
     * @param weatherFactor 天气系数
     * @return 实际速度（公里/小时）
     */
    public double calculateActualSpeed(String transportMode, String roadType, double weatherFactor) {
        double baseSpeed;
        switch (transportMode) {
            case "步行":
                baseSpeed = 7.5;
                break;
            case "骑行":
                baseSpeed = 20.0;
                break;
            case "开车":
                baseSpeed = ROAD_TYPE_SPEEDS.getOrDefault(roadType, 40.0);
                break;
            default:
                baseSpeed = 7.5;
        }

        double timeFactor = getTimePeriodFactor();
        return baseSpeed * timeFactor * weatherFactor;
    }

    /**
     * 计算模型预估时间（综合考虑所有因素）
     * @param distance 距离（公里）
     * @param transportMode 交通方式
     * @param originLng 起点经度
     * @param originLat 起点纬度
     * @param destLng 终点经度
     * @param destLat 终点纬度
     * @return 预计时间（分钟）
     */
    public double calculateModelEstimateTime(double distance, String transportMode,
                                           double originLng, double originLat,
                                           double destLng, double destLat) {
        String roadType = getRoadType((originLng + destLng) / 2, (originLat + destLat) / 2);
        Map<String, Object> weatherInfo = getWeatherInfo((originLng + destLng) / 2, (originLat + destLat) / 2);
        double weatherFactor = (Double) weatherInfo.getOrDefault("weather_factor", 1.0);
        
        double actualSpeed = calculateActualSpeed(transportMode, roadType, weatherFactor);
        double baseTime = (distance / actualSpeed) * 60;

        // 添加红绿灯等待时间
        String origin = originLng + "," + originLat;
        String destination = destLng + "," + destLat;
        Map<String, Object> trafficInfo = getTrafficInfo(origin, destination);
        double trafficLightWait = (Double) trafficInfo.getOrDefault("traffic_light_wait_time", 0.0);
        
        return baseTime + (trafficLightWait / 60);
    }

    /**
     * 计算城市特性保护时间（考虑城市平均拥堵水平）
     * @param distance 距离（公里）
     * @param transportMode 交通方式
     * @return 保护时间（分钟）
     */
    public double calculateCityProtectionTime(double distance, String transportMode) {
        double baseSpeed;
        switch (transportMode) {
            case "步行":
                baseSpeed = 5.0; // 保守估计
                break;
            case "骑行":
                baseSpeed = 15.0; // 保守估计
                break;
            case "开车":
                baseSpeed = 25.0; // 保守估计，考虑城市拥堵
                break;
            default:
                baseSpeed = 5.0;
        }
        return (distance / baseSpeed) * 60;
    }

    /**
     * 计算分段累加保护时间（考虑取车、行驶、交付各阶段）
     * @param distance 距离（公里）
     * @param transportMode 交通方式
     * @return 保护时间（分钟）
     */
    public double calculateSegmentProtectionTime(double distance, String transportMode) {
        double baseSpeed;
        switch (transportMode) {
            case "步行":
                baseSpeed = 6.0;
                break;
            case "骑行":
                baseSpeed = 18.0;
                break;
            case "开车":
                baseSpeed = 30.0;
                break;
            default:
                baseSpeed = 6.0;
        }
        
        double travelTime = (distance / baseSpeed) * 60;
        double pickupTime = 2.0; // 取车/准备时间
        double deliveryTime = 3.0; // 末端交付时间（小区门禁、电梯等）
        
        return travelTime + pickupTime + deliveryTime;
    }

    /**
     * 计算实际距离保护时间（基于实际道路距离）
     * @param distance 直线距离（公里）
     * @param transportMode 交通方式
     * @return 保护时间（分钟）
     */
    public double calculateDistanceProtectionTime(double distance, String transportMode) {
        double roadFactor = 1.3; // 道路距离通常是直线距离的1.2-1.5倍
        double actualRoadDistance = distance * roadFactor;
        
        double baseSpeed;
        switch (transportMode) {
            case "步行":
                baseSpeed = 5.5;
                break;
            case "骑行":
                baseSpeed = 16.0;
                break;
            case "开车":
                baseSpeed = 28.0;
                break;
            default:
                baseSpeed = 5.5;
        }
        
        return (actualRoadDistance / baseSpeed) * 60;
    }

    /**
     * 计算最终预估时间（取四个时间的最大值，参考美团的四层保护机制）
     * @param distance 距离（公里）
     * @param transportMode 交通方式
     * @param originLng 起点经度
     * @param originLat 起点纬度
     * @param destLng 终点经度
     * @param destLat 终点纬度
     * @return 最终预估时间（分钟）
     */
    public Map<String, Object> calculateFinalEstimateTime(double distance, String transportMode,
                                                        double originLng, double originLat,
                                                        double destLng, double destLat) {
        Map<String, Object> result = new HashMap<>();
        
        // 1. 模型预估时间
        double modelTime = calculateModelEstimateTime(distance, transportMode, originLng, originLat, destLng, destLat);
        
        // 2. 城市特性保护时间
        double cityProtectionTime = calculateCityProtectionTime(distance, transportMode);
        
        // 3. 分段累加保护时间
        double segmentProtectionTime = calculateSegmentProtectionTime(distance, transportMode);
        
        // 4. 实际距离保护时间
        double distanceProtectionTime = calculateDistanceProtectionTime(distance, transportMode);
        
        // 取最大值作为最终时间
        double finalTime = Math.max(Math.max(modelTime, cityProtectionTime), 
                                   Math.max(segmentProtectionTime, distanceProtectionTime));
        
        // 获取天气信息用于返回
        Map<String, Object> weatherInfo = getWeatherInfo((originLng + destLng) / 2, (originLat + destLat) / 2);
        
        result.put("model_time", modelTime);
        result.put("city_protection_time", cityProtectionTime);
        result.put("segment_protection_time", segmentProtectionTime);
        result.put("distance_protection_time", distanceProtectionTime);
        result.put("final_time", finalTime);
        result.put("weather", weatherInfo.get("weather"));
        result.put("weather_factor", weatherInfo.get("weather_factor"));
        
        return result;
    }

    /**
     * 估算实际行程时间（兼容旧接口）
     * @param distance 距离（公里）
     * @param transportMode 交通方式
     * @param originLng 起点经度
     * @param originLat 起点纬度
     * @param destLng 终点经度
     * @param destLat 终点纬度
     * @return 预计时间（分钟）
     */
    public double estimateActualTime(double distance, String transportMode,
                                   double originLng, double originLat,
                                   double destLng, double destLat) {
        Map<String, Object> result = calculateFinalEstimateTime(distance, transportMode, 
                                                               originLng, originLat, 
                                                               destLng, destLat);
        return (Double) result.get("final_time");
    }
}