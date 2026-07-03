package com.example.tongxinproject.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.tongxinproject.common.JwtTokenProvider;
import com.example.tongxinproject.common.RateLimiter;
import com.example.tongxinproject.entity.User;
import com.example.tongxinproject.mapper.UserMapper;
import com.example.tongxinproject.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@Service
public class UserServiceImpl implements UserService {

    private static final Logger log = LoggerFactory.getLogger(UserServiceImpl.class);

    @Autowired
    private UserMapper userMapper;

    @Autowired(required = false)
    private JwtTokenProvider jwtTokenProvider;

    @Autowired(required = false)
    private RateLimiter rateLimiter;

    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    @Override
    public User login(String username, String password) {
        // 限流检查
        if (rateLimiter != null) {
            String rateLimitKey = "login:" + username;
            if (rateLimiter.isLocked(rateLimitKey)) {
                long remaining = rateLimiter.getLockSecondsRemaining(rateLimitKey);
                log.warn("Login blocked for user '{}' - rate limited ({}s remaining)", username, remaining);
                return null;
            }
        }

        User user = findByUsername(username);
        if (user == null || !passwordEncoder.matches(password, user.getPassword())) {
            // 记录失败尝试
            if (rateLimiter != null) {
                rateLimiter.recordFailure("login:" + username);
            }
            return null;
        }

        // 登录成功，重置限流计数
        if (rateLimiter != null) {
            rateLimiter.reset("login:" + username);
        }
        return user;
    }

    /**
     * 登录并返回包含JWT的结果
     */
    public Map<String, Object> loginWithToken(String username, String password) {
        User user = login(username, password);
        if (user == null) {
            return null;
        }

        Map<String, Object> result = new HashMap<>();
        result.put("user", sanitizeUser(user));

        // 签发JWT
        if (jwtTokenProvider != null) {
            String token = jwtTokenProvider.generateToken(user.getId(), user.getUsername(), user.getRole());
            result.put("token", token);
            result.put("tokenType", "Bearer");
            result.put("expiresIn", 86400);
        }

        return result;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public User register(String username, String password, String role, String nickname) {
        User existingUser = findByUsername(username);
        if (existingUser != null) {
            return null;
        }

        User user = new User();
        user.setUsername(username);
        user.setPassword(passwordEncoder.encode(password));
        user.setRole(role);
        user.setNickname(nickname != null ? nickname : username);
        user.setCreateTime(LocalDateTime.now());
        user.setUpdateTime(LocalDateTime.now());

        userMapper.insert(user);
        log.info("User registered: {} (role: {})", username, role);
        return user;
    }

    @Override
    public User findByUsername(String username) {
        QueryWrapper<User> wrapper = new QueryWrapper<>();
        wrapper.eq("username", username);
        return userMapper.selectOne(wrapper);
    }

    @Override
    public String generateGuestToken() {
        if (jwtTokenProvider != null) {
            return jwtTokenProvider.generateToken(0L, "guest_anonymous", "guest");
        }
        return null;
    }

    private User sanitizeUser(User user) {
        user.setPassword(null);
        return user;
    }
}
