package com.example.tongxinproject.config;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

@Component
public class CommandWebSocketHandler extends TextWebSocketHandler {

    private static final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private static final Map<String, Map<String, Object>> connectionRequests = new ConcurrentHashMap<>();
    private static final Map<String, Map<String, Object>> connectedOfficers = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String sessionId = session.getId();
        sessions.put(sessionId, session);
        sendMessage(session, JSON.toJSONString(Map.of(
                "type", "OPEN",
                "message", "连接成功，会话ID: " + sessionId
        )));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        try {
            JSONObject json = JSON.parseObject(payload);
            String type = json.getString("type");
            
            if ("PING".equals(type)) {
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "PONG",
                        "timestamp", System.currentTimeMillis()
                )));
            } else if ("MESSAGE".equals(type)) {
                String payloadPlain = json.getString("payloadPlain");
                String role = json.getString("role");
                String roleName = "未知";
                if ("commander".equals(role)) {
                    roleName = "指挥中心";
                } else if ("officer".equals(role)) {
                    // 从已连接警员列表中获取真实姓名，不再统一叫"巡逻组"
                    Map<String, Object> officer = connectedOfficers.get(session.getId());
                    if (officer != null && officer.get("name") != null) {
                        roleName = (String) officer.get("name");
                    } else {
                        roleName = "警员";
                    }
                }
                broadcastMessage(JSON.toJSONString(Map.of(
                        "type", "BROADCAST",
                        "from", session.getId(),
                        "role", role,
                        "roleName", roleName,
                        "payload", payloadPlain,
                        "timestamp", System.currentTimeMillis()
                )));
            } else if ("CONNECT_REQUEST".equals(type)) {
                String role = json.getString("role");
                String unitId = json.getString("unitId");
                String name = json.getString("name");
                
                if ("officer".equals(role)) {
                    Map<String, Object> request = new ConcurrentHashMap<>();
                    request.put("sessionId", session.getId());
                    request.put("role", role);
                    request.put("unitId", unitId);
                    request.put("name", name);
                    connectionRequests.put(session.getId(), request);
                    
                    // 广播连接请求给所有指挥端
                    broadcastMessage(JSON.toJSONString(Map.of(
                            "type", "CONNECTION_REQUEST",
                            "sessionId", session.getId(),
                            "role", role,
                            "unitId", unitId,
                            "name", name
                    )));
                }
            } else if ("CONNECT_RESPONSE".equals(type)) {
                String targetSessionId = json.getString("targetSessionId");
                boolean accepted = json.getBoolean("accepted");
                String reason = json.getString("reason");
                
                // 发送响应给请求方
                WebSocketSession targetSession = sessions.get(targetSessionId);
                if (targetSession != null && targetSession.isOpen()) {
                    sendMessage(targetSession, JSON.toJSONString(Map.of(
                            "type", "CONNECT_RESPONSE",
                            "accepted", accepted,
                            "reason", reason
                    )));
                }
                
                // 如果接受连接，添加到已连接警员列表
                if (accepted) {
                    Map<String, Object> request = connectionRequests.get(targetSessionId);
                    if (request != null) {
                        // 初始化状态为执勤中
                        request.put("status", "执勤中");
                        // 初始化位置信息（默认值，后续会通过位置更新消息更新）
                        request.put("lng", 0.0);
                        request.put("lat", 0.0);
                        connectedOfficers.put(targetSessionId, request);
                        connectionRequests.remove(targetSessionId);
                    }
                }
                
                // 广播响应给所有指挥端
                broadcastMessage(JSON.toJSONString(Map.of(
                        "type", "CONNECT_RESPONSE_BROADCAST",
                        "targetSessionId", targetSessionId,
                        "accepted", accepted,
                        "reason", reason
                )));
                
                // 广播已连接警员列表给所有指挥端
                broadcastMessage(JSON.toJSONString(Map.of(
                        "type", "CONNECTED_OFFICERS",
                        "officers", connectedOfficers
                )));
            } else if ("COMMAND".equals(type)) {
                String targetSessionId = json.getString("targetSessionId");
                JSONObject order = json.getJSONObject("order");
                String orderId = order != null ? order.getString("id") : null;
                String eventId = order != null ? order.getString("eventId") : null;
                String eventType = order != null ? order.getString("eventType") : null;
                String officerName = order != null ? order.getString("officerName") : null;

                boolean delivered = false;
                // 发送指令给目标警员
                WebSocketSession targetSession = sessions.get(targetSessionId);
                if (targetSession != null && targetSession.isOpen()) {
                    sendMessage(targetSession, JSON.toJSONString(Map.of(
                            "type", "COMMAND",
                            "order", order
                    )));
                    delivered = true;
                }

                // 发送确认给指挥中心（包含事件ID以便更新状态）
                Map<String, Object> ackMap = new java.util.HashMap<>();
                ackMap.put("type", "COMMAND_ACK");
                ackMap.put("orderId", orderId);
                ackMap.put("eventId", eventId);
                ackMap.put("delivered", delivered);
                ackMap.put("message", delivered ? "指令已发送" : "目标警员不在线");
                sendMessage(session, JSON.toJSONString(ackMap));

                // 广播事件状态更新给所有指挥端
                if (eventId != null) {
                    Map<String, Object> statusMap = new java.util.HashMap<>();
                    statusMap.put("type", "EVENT_STATUS_UPDATE");
                    statusMap.put("eventId", eventId);
                    statusMap.put("status", "已指派");
                    statusMap.put("eventType", eventType);
                    statusMap.put("officerName", officerName);
                    statusMap.put("orderId", orderId);
                    broadcastMessage(JSON.toJSONString(statusMap));
                }
            } else if ("STATUS_UPDATE".equals(type)) {
                String status = json.getString("status");
                String sessionId = session.getId();
                
                // 更新警员状态
                Map<String, Object> officer = connectedOfficers.get(sessionId);
                if (officer != null) {
                    officer.put("status", status);
                    
                    // 广播状态更新给所有指挥端
                    broadcastMessage(JSON.toJSONString(Map.of(
                            "type", "STATUS_UPDATE",
                            "sessionId", sessionId,
                            "status", status
                    )));
                    
                    // 广播更新后的已连接警员列表
                    broadcastMessage(JSON.toJSONString(Map.of(
                            "type", "CONNECTED_OFFICERS",
                            "officers", connectedOfficers
                    )));
                }
                
                // 发送确认给警员
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "STATUS_UPDATE_ACK",
                        "message", "状态已更新"
                )));
            } else if ("TRANSPORT_MODE_UPDATE".equals(type)) {
                String transportMode = json.getString("transportMode");
                String sessionId = session.getId();
                
                // 更新警员交通方式
                Map<String, Object> officer = connectedOfficers.get(sessionId);
                if (officer != null) {
                    officer.put("transportMode", transportMode);
                    
                    // 广播交通方式更新给所有指挥端
                    broadcastMessage(JSON.toJSONString(Map.of(
                            "type", "TRANSPORT_MODE_UPDATE",
                            "sessionId", sessionId,
                            "transportMode", transportMode
                    )));
                    
                    // 广播更新后的已连接警员列表
                    broadcastMessage(JSON.toJSONString(Map.of(
                            "type", "CONNECTED_OFFICERS",
                            "officers", connectedOfficers
                    )));
                }
                
                // 发送确认给警员
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "TRANSPORT_MODE_UPDATE_ACK",
                        "message", "交通方式已更新"
                )));
            } else if ("TASK_COMPLETED".equals(type)) {
                String orderId = json.getString("orderId");
                String orderTitle = json.getString("orderTitle");
                String eventId = json.getString("eventId");
                JSONObject completedEvent = json.getJSONObject("completedEvent");
                String sessionId = session.getId();
                
                // 广播任务完成通知给所有客户端
                Map<String, Object> officer = connectedOfficers.get(sessionId);
                if (officer != null) {
                    String officerName = (String) officer.get("name");
                    String unitId = (String) officer.get("unitId");
                    
                    Map<String, Object> messageMap = new java.util.HashMap<>();
                    messageMap.put("type", "TASK_COMPLETED");
                    messageMap.put("sessionId", sessionId);
                    messageMap.put("officerName", officerName);
                    messageMap.put("unitId", unitId);
                    messageMap.put("orderId", orderId);
                    messageMap.put("orderTitle", orderTitle);
                    if (eventId != null) {
                        messageMap.put("eventId", eventId);
                    }
                    if (completedEvent != null) {
                        messageMap.put("completedEvent", completedEvent);
                    }
                    
                    broadcastMessage(JSON.toJSONString(messageMap));
                }
                
                // 发送确认给警员
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "TASK_COMPLETED_ACK",
                        "message", "任务完成通知已发送"
                )));
            } else if ("EVENT_REPORTED".equals(type)) {
                JSONObject event = json.getJSONObject("event");
                String sessionId = session.getId();
                
                // 广播事件上报通知给所有指挥端
                Map<String, Object> officer = connectedOfficers.get(sessionId);
                if (officer != null) {
                    String officerName = (String) officer.get("name");
                    String unitId = (String) officer.get("unitId");
                    
                    Map<String, Object> messageMap = new java.util.HashMap<>();
                    messageMap.put("type", "EVENT_REPORTED");
                    messageMap.put("sessionId", sessionId);
                    messageMap.put("officerName", officerName);
                    messageMap.put("unitId", unitId);
                    messageMap.put("event", event);
                    
                    broadcastMessage(JSON.toJSONString(messageMap));
                }
                
                // 发送确认给警员
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "EVENT_REPORTED_ACK",
                        "message", "事件上报通知已发送"
                )));
            } else if ("SAFETY_REPORT".equals(type)) {
                JSONObject report = json.getJSONObject("report");
                
                // 广播安全隐患上报通知给所有指挥端
                Map<String, Object> messageMap = new java.util.HashMap<>();
                messageMap.put("type", "SAFETY_REPORT");
                messageMap.put("report", report);
                
                broadcastMessage(JSON.toJSONString(messageMap));
                
                // 发送确认给公众
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "SAFETY_REPORT_ACK",
                        "message", "安全隐患上报已接收"
                )));
            } else if ("EVENT_FEEDBACK".equals(type)) {
                JSONObject feedback = json.getJSONObject("feedback");
                
                // 广播事件反馈通知给所有指挥端
                Map<String, Object> messageMap = new java.util.HashMap<>();
                messageMap.put("type", "EVENT_FEEDBACK");
                messageMap.put("feedback", feedback);
                
                broadcastMessage(JSON.toJSONString(messageMap));
                
                // 发送确认给公众
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "EVENT_FEEDBACK_ACK",
                        "message", "事件反馈已接收"
                )));
            } else if ("LOCATION_UPDATE".equals(type)) {
                double lng = json.getDouble("lng");
                double lat = json.getDouble("lat");
                String sessionId = session.getId();
                
                // 更新警员位置
                Map<String, Object> officer = connectedOfficers.get(sessionId);
                if (officer != null) {
                    officer.put("lng", lng);
                    officer.put("lat", lat);
                    
                    // 广播位置更新给所有指挥端
                    broadcastMessage(JSON.toJSONString(Map.of(
                            "type", "LOCATION_UPDATE",
                            "sessionId", sessionId,
                            "lng", lng,
                            "lat", lat
                    )));
                    
                    // 广播更新后的已连接警员列表
                    broadcastMessage(JSON.toJSONString(Map.of(
                            "type", "CONNECTED_OFFICERS",
                            "officers", connectedOfficers
                    )));
                }
                
                // 发送确认给警员
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "LOCATION_UPDATE_ACK",
                        "message", "位置已更新"
                )));
            } else {
                sendMessage(session, JSON.toJSONString(Map.of(
                        "type", "ACK",
                        "message", "消息已接收"
                )));
            }
        } catch (Exception e) {
            sendMessage(session, JSON.toJSONString(Map.of(
                    "type", "ERROR",
                    "message", "消息解析失败: " + e.getMessage()
            )));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String sessionId = session.getId();
        sessions.remove(sessionId);
        connectionRequests.remove(sessionId);
        connectedOfficers.remove(sessionId);
        
        // 广播连接关闭消息
        broadcastMessage(JSON.toJSONString(Map.of(
                "type", "CONNECTION_CLOSED",
                "sessionId", sessionId
        )));
        
        // 广播更新后的已连接警员列表
        broadcastMessage(JSON.toJSONString(Map.of(
                "type", "CONNECTED_OFFICERS",
                "officers", connectedOfficers
        )));
    }

    private void sendMessage(WebSocketSession session, String message) throws IOException {
        if (session.isOpen()) {
            session.sendMessage(new TextMessage(message));
        }
    }

    private void broadcastMessage(String message) throws IOException {
        for (WebSocketSession session : sessions.values()) {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(message));
            }
        }
    }
}
