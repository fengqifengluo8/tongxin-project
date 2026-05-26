package com.example.tongxinproject.controller;

import com.example.tongxinproject.common.Result;
import com.example.tongxinproject.entity.User;
import com.example.tongxinproject.service.UserService;
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
    private UserService userService;

    @PostMapping("/login")
    public Result login(@RequestBody Map<String, String> request) {
        String username = request.get("username");
        String password = request.get("password");

        if (username == null || password == null) {
            return Result.error("用户名和密码不能为空");
        }

        User user = userService.login(username, password);
        if (user == null) {
            return Result.error("用户名或密码错误");
        }

        // 登录成功，返回用户信息（不含密码）
        user.setPassword(null);
        return Result.success(user);
    }

    @PostMapping("/register")
    public Result register(@RequestBody Map<String, String> request) {
        String username = request.get("username");
        String password = request.get("password");
        String role = request.get("role");
        String nickname = request.get("nickname");

        if (username == null || password == null || role == null) {
            return Result.error("用户名、密码和角色不能为空");
        }

        User user = userService.register(username, password, role, nickname);
        if (user == null) {
            return Result.error("用户名已存在");
        }

        // 注册成功，返回用户信息（不含密码）
        user.setPassword(null);
        return Result.success(user);
    }
}