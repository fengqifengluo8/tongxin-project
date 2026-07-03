package com.example.tongxinproject.config;

import com.example.tongxinproject.common.JwtTokenProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

/**
 * WebSocket握手认证拦截器
 * 从URL查询参数中读取token，验证JWT，将用户信息存入WebSocket session attributes
 */
public class WebSocketAuthInterceptor implements HandshakeInterceptor {

    private static final Logger log = LoggerFactory.getLogger(WebSocketAuthInterceptor.class);

    private final JwtTokenProvider jwtTokenProvider;

    public WebSocketAuthInterceptor(JwtTokenProvider jwtTokenProvider) {
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        log.info("WebSocket handshake request: URI={}, Origin={}", request.getURI(),
                request.getHeaders().getOrigin());
        // 提取token参数
        String token = null;
        if (request instanceof ServletServerHttpRequest servletRequest) {
            token = servletRequest.getServletRequest().getParameter("token");
        } else {
            // 从URI中解析 ?token=xxx
            String query = request.getURI().getQuery();
            if (query != null) {
                for (String param : query.split("&")) {
                    String[] pair = param.split("=", 2);
                    if (pair.length == 2 && "token".equals(pair[0])) {
                        token = pair[1];
                        break;
                    }
                }
            }
        }

        if (token == null) {
            log.warn("WebSocket handshake rejected: token missing, URI={}", request.getURI());
            return false;
        }
        if (!jwtTokenProvider.validateToken(token)) {
            log.warn("WebSocket handshake rejected: invalid token, token_preview={}, URI={}",
                    token.length() > 20 ? token.substring(0, 20) + "..." : token,
                    request.getURI());
            return false;
        }

        // 将用户信息存入WebSocket session attributes
        attributes.put("userId", jwtTokenProvider.getUserId(token));
        attributes.put("username", jwtTokenProvider.getUsername(token));
        attributes.put("userRole", jwtTokenProvider.getRole(token));
        log.debug("WebSocket authenticated: {} ({})",
                jwtTokenProvider.getUsername(token), jwtTokenProvider.getRole(token));
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // no-op
    }
}
