package com.example.tongxinproject.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.tongxinproject.common.Result;
import com.example.tongxinproject.dto.GuestFeedbackRequest;
import com.example.tongxinproject.entity.Alarm;
import com.example.tongxinproject.entity.PublicEvent;
import com.example.tongxinproject.mapper.AlarmMapper;
import com.example.tongxinproject.mapper.PublicEventMapper;
import jakarta.annotation.PostConstruct;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/guest")
public class GuestController {

    @Autowired
    private AlarmMapper alarmMapper;

    @Autowired
    private PublicEventMapper publicEventMapper;

    /**
     * 启动时检查公示事件是否为空，空则自动播种（武汉坐标）
     */
    @PostConstruct
    public void init() {
        if (publicEventMapper.selectCount(null) == 0) {
            seedDefaultPublicEvents();
        }
    }

    @PostMapping("/feedback")
    @Transactional(rollbackFor = Exception.class)
    public Result<Map<String, Object>> submitFeedback(@Valid @RequestBody GuestFeedbackRequest request) {
        Alarm alarm = new Alarm();
        alarm.setType(request.getVague() != null ? request.getVague() : "公众反馈");
        alarm.setContent(request.getText());
        if (request.getLng() != null && request.getLat() != null) {
            alarm.setLng(request.getLng());
            alarm.setLat(request.getLat());
            alarm.setAddress(request.getAddress());
        }
        alarm.setReporter("guest");
        alarm.setStatus("pending");
        alarm.setReportTime(LocalDateTime.now());
        alarm.setCreateTime(LocalDateTime.now());
        alarm.setUpdateTime(LocalDateTime.now());
        alarmMapper.insert(alarm);

        Map<String, Object> data = new HashMap<>();
        data.put("id", alarm.getId());
        data.put("message", "反馈已提交");
        return Result.success(data);
    }

    /**
     * 获取公示事件（纯读操作，不在GET中修改数据库）
     */
    @GetMapping("/public/event")
    public Result<List<PublicEvent>> getPublicEvents(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size) {
        LambdaQueryWrapper<PublicEvent> wrapper = new LambdaQueryWrapper<>();
        wrapper.orderByDesc(PublicEvent::getCreateTime);
        List<PublicEvent> events = publicEventMapper.selectList(wrapper);
        return Result.success(events);
    }

    /**
     * 播种默认公示事件（武汉坐标，与系统主服务区一致）
     */
    void seedDefaultPublicEvents() {
        PublicEvent event1 = new PublicEvent();
        event1.setType("交通");
        event1.setTitle("主干道养护提示");
        event1.setArea("环城路（大致区域）");
        event1.setEventTime("今日 14:00—18:00");
        event1.setTip("该路段可能拥堵，建议绕行南侧辅路。");
        event1.setLng(114.305558);
        event1.setLat(30.592759);
        event1.setCreateTime(LocalDateTime.now());
        event1.setUpdateTime(LocalDateTime.now());
        publicEventMapper.insert(event1);

        PublicEvent event2 = new PublicEvent();
        event2.setType("公益");
        event2.setTitle("公共安全宣传周");
        event2.setArea("市民中心广场");
        event2.setEventTime("本周末");
        event2.setTip("现场有互动体验与应急知识讲解，欢迎参与。");
        event2.setLng(114.310000);
        event2.setLat(30.598000);
        event2.setCreateTime(LocalDateTime.now());
        event2.setUpdateTime(LocalDateTime.now());
        publicEventMapper.insert(event2);

        PublicEvent event3 = new PublicEvent();
        event3.setType("提示");
        event3.setTitle("夜间出行提醒");
        event3.setArea("滨水步道一带");
        event3.setEventTime("持续");
        event3.setTip("夜间光线较暗，请注意脚下与结伴而行。");
        event3.setLng(114.295000);
        event3.setLat(30.585000);
        event3.setCreateTime(LocalDateTime.now());
        event3.setUpdateTime(LocalDateTime.now());
        publicEventMapper.insert(event3);
    }
}
