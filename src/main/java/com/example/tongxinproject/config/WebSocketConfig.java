package com.example.tongxinproject.config;

import com.example.tongxinproject.common.JwtTokenProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.*;

import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final CommandWebSocketHandler handler;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Value("${cors.allowed-origins:*}")
    private String allowedOriginsConfig;

    public WebSocketConfig(CommandWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        List<String> allowedOrigins = Arrays.asList(allowedOriginsConfig.split(","));
        registry.addHandler(handler, "/ws/command")
                .addInterceptors(new WebSocketAuthInterceptor(jwtTokenProvider))
                .setAllowedOrigins(allowedOrigins.toArray(new String[0]));
    }
}
