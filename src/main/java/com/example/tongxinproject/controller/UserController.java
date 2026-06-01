package com.example.tongxinproject.controller;

import com.example.tongxinproject.common.RateLimiter;
import com.example.tongxinproject.common.Result;
import com.example.tongxinproject.dto.LoginRequest;
import com.example.tongxinproject.dto.RegisterRequest;
import com.example.tongxinproject.entity.User;
import com.example.tongxinproject.service.impl.UserServiceImpl;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/user")
public class UserController {

    @Autowired
    private UserServiceImpl userService;

    @Autowired(required = false)
    private RateLimiter rateLimiter;

    @PostMapping("/login")
    public Result<Map<String, Object>> login(@Valid @RequestBody LoginRequest request) {
        Map<String, Object> result = userService.loginWithToken(
                request.getUsername(), request.getPassword());
        if (result == null) {
            return Result.error("用户名或密码错误");
        }
        return Result.success(result);
    }

    @PostMapping("/register")
    public Result<Map<String, Object>> register(@Valid @RequestBody RegisterRequest request) {
        // 注册限流
        if (rateLimiter != null && rateLimiter.isLocked("register:" + request.getUsername())) {
            return Result.error("操作过于频繁，请稍后重试");
        }
        if (rateLimiter != null) {
            rateLimiter.recordFailure("register:" + request.getUsername());
        }
        User user = userService.register(
            request.getUsername(),
            request.getPassword(),
            request.getRole(),
            request.getNickname()
        );
        if (user == null) {
            return Result.error("用户名已存在");
        }

        user.setPassword(null);
        // 注册成功后自动签发JWT
        Map<String, Object> result = userService.loginWithToken(
                request.getUsername(), request.getPassword());
        return Result.success(result);
    }
}
