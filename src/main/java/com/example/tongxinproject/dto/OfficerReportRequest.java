package com.example.tongxinproject.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class OfficerReportRequest {
    @NotBlank(message = "事件类型不能为空")
    @Size(max = 50, message = "类型长度不能超过50个字符")
    private String type;

    @NotBlank(message = "事件说明不能为空")
    @Size(max = 1000, message = "说明长度不能超过1000个字符")
    private String text;

    @Pattern(regexp = "低|中|高", message = "优先级必须为低、中或高")
    private String priority;

    private Boolean useLocation;
    private Double lng;
    private Double lat;

    @Size(max = 500, message = "地址长度不能超过500个字符")
    private String address;
}
