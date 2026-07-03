package com.example.tongxinproject.service;

import com.example.tongxinproject.entity.User;

import java.util.Map;

public interface UserService {
    User login(String username, String password);
    User register(String username, String password, String role, String nickname);
    User findByUsername(String username);

    /**
     * 登录并返回包含JWT令牌的结果
     * @return 包含user、token字段的Map，失败返回null
     */
    Map<String, Object> loginWithToken(String username, String password);

    /**
     * 为匿名访客生成受限JWT令牌（公众端使用）
     */
    String generateGuestToken();
}
