package com.example.tongxinproject.controller;

import com.example.tongxinproject.common.Result;
import com.example.tongxinproject.dto.OfficerReportRequest;
import com.example.tongxinproject.entity.Alarm;
import com.example.tongxinproject.mapper.AlarmMapper;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/officer")
public class OfficerController {

    @Autowired
    private AlarmMapper alarmMapper;

    @PostMapping("/report")
    @Transactional
    public Result<Map<String, Object>> reportEvent(@Valid @RequestBody OfficerReportRequest request) {
        Alarm alarm = new Alarm();
        alarm.setType(request.getType());
        alarm.setContent(request.getText());
        if (request.getUseLocation() != null && request.getUseLocation()) {
            alarm.setLng(request.getLng());
            alarm.setLat(request.getLat());
            alarm.setAddress(request.getAddress());
        }
        alarm.setReporter("officer");
        alarm.setStatus("pending");
        alarm.setReportTime(LocalDateTime.now());
        alarm.setCreateTime(LocalDateTime.now());
        alarm.setUpdateTime(LocalDateTime.now());
        alarmMapper.insert(alarm);

        Map<String, Object> data = new HashMap<>();
        data.put("id", alarm.getId());
        data.put("message", "事件已上报");
        return Result.success(data);
    }

    @PostMapping("/reinforce")
    @Transactional
    public Result<Map<String, Object>> requestReinforce(@Valid @RequestBody OfficerReportRequest request) {
        Alarm alarm = new Alarm();
        alarm.setType("增援请求");
        alarm.setContent(request.getText());
        // 统一使用useLocation字段判断是否附带位置
        if (request.getUseLocation() != null && request.getUseLocation()
                && request.getLng() != null && request.getLat() != null) {
            alarm.setLng(request.getLng());
            alarm.setLat(request.getLat());
            alarm.setAddress(request.getAddress());
        }
        alarm.setReporter("officer");
        alarm.setStatus("urgent");
        alarm.setReportTime(LocalDateTime.now());
        alarm.setCreateTime(LocalDateTime.now());
        alarm.setUpdateTime(LocalDateTime.now());
        alarmMapper.insert(alarm);

        Map<String, Object> data = new HashMap<>();
        data.put("id", alarm.getId());
        data.put("message", "增援请求已发送");
        return Result.success(data);
    }
}
