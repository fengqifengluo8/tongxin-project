package com.example.tongxinproject.config;

import org.apache.catalina.connector.Connector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * HTTPS配置: 自动将HTTP请求重定向到HTTPS
 * 仅在dev和prod环境启用
 */
@Configuration
@Profile({"dev", "prod"})
public class HttpsConfig {

    @Value("${server.http.port:6061}")
    private int httpPort;

    @Value("${server.port:8443}")
    private int httpsPort;

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> httpsRedirectCustomizer() {
        return factory -> {
            Connector connector = new Connector(TomcatServletWebServerFactory.DEFAULT_PROTOCOL);
            connector.setPort(httpPort);
            connector.setRedirectPort(httpsPort);
            // 不设置secure=true，允许HTTP仅用于重定向
            connector.setSecure(false);
            connector.setScheme("http");
            factory.addAdditionalTomcatConnectors(connector);
        };
    }
}
