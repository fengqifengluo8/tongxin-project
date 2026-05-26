package com.example.tongxinproject.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.tongxinproject.common.Result;
import com.example.tongxinproject.entity.Alarm;
import com.example.tongxinproject.mapper.AlarmMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/commander")
public class CommanderController {

    @Autowired
    private AlarmMapper alarmMapper;

    @GetMapping("/events")
    public Result<List<Alarm>> getEvents() {
        LambdaQueryWrapper<Alarm> wrapper = new LambdaQueryWrapper<>();
        wrapper.orderByDesc(Alarm::getReportTime);
        List<Alarm> events = alarmMapper.selectList(wrapper);
        return Result.success(events);
    }
}
