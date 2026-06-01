package com.example.tongxinproject.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class GuestFeedbackRequest {
    @Size(max = 200, message = "方位描述长度不能超过200个字符")
    private String vague;

    @NotBlank(message = "反馈说明不能为空")
    @Size(max = 1000, message = "说明长度不能超过1000个字符")
    private String text;

    private Double lng;
    private Double lat;

    @Size(max = 500, message = "地址长度不能超过500个字符")
    private String address;
}
