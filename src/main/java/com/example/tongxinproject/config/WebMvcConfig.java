package com.example.tongxinproject.config;

import com.example.tongxinproject.common.JwtTokenProvider;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Spring MVC配置：注册JWT认证拦截器
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AuthInterceptor(jwtTokenProvider))
                .addPathPatterns("/api/**")
                .excludePathPatterns(
                        "/api/user/login",
                        "/api/user/register",
                        "/api/guest/public/**"  // 公示事件公开访问
                )
                .order(1);
    }

    /**
     * JWT认证拦截器
     */
    public static class AuthInterceptor implements HandlerInterceptor {

        private static final Logger log = LoggerFactory.getLogger(AuthInterceptor.class);
        private final JwtTokenProvider jwtTokenProvider;

        public AuthInterceptor(JwtTokenProvider jwtTokenProvider) {
            this.jwtTokenProvider = jwtTokenProvider;
        }

        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                                 Object handler) throws Exception {
            // OPTIONS预检请求放行
            if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                return true;
            }

            String authHeader = request.getHeader("Authorization");
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                response.setStatus(HttpStatus.UNAUTHORIZED.value());
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"code\":401,\"msg\":\"未登录或令牌缺失\"}");
                return false;
            }

            String token = authHeader.substring(7);
            if (!jwtTokenProvider.validateToken(token)) {
                response.setStatus(HttpStatus.UNAUTHORIZED.value());
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"code\":401,\"msg\":\"令牌无效或已过期\"}");
                return false;
            }

            // 将用户信息存入request属性，供Controller使用
            request.setAttribute("userId", jwtTokenProvider.getUserId(token));
            request.setAttribute("username", jwtTokenProvider.getUsername(token));
            request.setAttribute("userRole", jwtTokenProvider.getRole(token));

            return true;
        }
    }
}
