package com.example.tongxinproject.service;

import com.example.tongxinproject.entity.User;

public interface UserService {
    User login(String username, String password);
    User register(String username, String password, String role, String nickname);
    User findByUsername(String username);
}