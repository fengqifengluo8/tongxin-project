package com.example.tongxinproject.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.tongxinproject.entity.User;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface UserMapper extends BaseMapper<User> {
}