package com.example.tongxinproject.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * 服务端IP定位 — 多API保底，不依赖浏览器HTTPS/GPS权限
 */
@RestController
public class LocationController {

    @Value("${amap.key}")
    private String amapKey;

    @GetMapping("/api/location/ip")
    public Map<String, Object> getIpLocation(HttpServletRequest request) {
        String ip = getClientIp(request);

        // 方案1：高德IP定位API
        Map<String, Object> result = tryAmapIp(ip);
        if (result != null) return result;

        // 方案2：ipapi.co（免费，无需Key）
        result = tryIpapiCo(ip);
        if (result != null) return result;

        // 方案3：ipinfo.io（免费，无需Key）
        result = tryIpinfoIo(ip);
        if (result != null) return result;

        // 最终兜底：默认坐标
        return defaultLocation();
    }

    private Map<String, Object> tryAmapIp(String ip) {
        try {
            String urlStr = "https://restapi.amap.com/v3/ip?key=" + amapKey
                    + "&ip=" + ip + "&output=json";
            String jsonStr = httpGet(urlStr, 3000);
            if (jsonStr == null) return null;

            JSONObject json = JSON.parseObject(jsonStr);
            if ("1".equals(json.getString("status"))) {
                String rectangle = json.getString("rectangle");
                if (rectangle != null && rectangle.contains(";")) {
                    String[] parts = rectangle.split(";")[0].split(",");
                    return Map.of("success", true,
                        "lng", Double.parseDouble(parts[0]),
                        "lat", Double.parseDouble(parts[1]),
                        "city", json.getString("city"),
                        "method", "amap-ip");
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private Map<String, Object> tryIpapiCo(String ip) {
        try {
            String jsonStr = httpGet("https://ipapi.co/" + ip + "/json/", 5000);
            if (jsonStr == null) return null;
            JSONObject json = JSON.parseObject(jsonStr);
            if (json.getDouble("latitude") != null && json.getDouble("latitude") != 0) {
                return Map.of("success", true,
                    "lng", json.getDouble("longitude"),
                    "lat", json.getDouble("latitude"),
                    "city", json.getString("city"),
                    "method", "ipapi.co");
            }
        } catch (Exception ignored) {}
        return null;
    }

    private Map<String, Object> tryIpinfoIo(String ip) {
        try {
            String jsonStr = httpGet("https://ipinfo.io/" + ip + "/json", 5000);
            if (jsonStr == null) return null;
            JSONObject json = JSON.parseObject(jsonStr);
            String loc = json.getString("loc");
            if (loc != null && loc.contains(",")) {
                String[] parts = loc.split(",");
                return Map.of("success", true,
                    "lng", Double.parseDouble(parts[1]),
                    "lat", Double.parseDouble(parts[0]),
                    "city", json.getString("city"),
                    "method", "ipinfo.io");
            }
        } catch (Exception ignored) {}
        return null;
    }

    private Map<String, Object> defaultLocation() {
        return Map.of("success", true,
            "lng", 114.305558, "lat", 30.592759,
            "city", "武汉", "method", "default");
    }

    private String httpGet(String urlStr, int timeoutMs) {
        try {
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) sb.append(line);
            in.close();
            return sb.toString();
        } catch (Exception e) { return null; }
    }

    private String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip))
            ip = request.getHeader("X-Real-IP");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip))
            ip = request.getHeader("Proxy-Client-IP");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip))
            ip = request.getRemoteAddr();
        if (ip != null && ip.contains(",")) ip = ip.split(",")[0].trim();
        return ip != null ? ip : "127.0.0.1";
    }
}
