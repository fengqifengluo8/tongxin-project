package com.example.tongxinproject.dto;

import lombok.Data;

@Data
public class OfficerReportRequest {
    private String type;
    private String text;
    private String priority;
    private Boolean useLocation;
    private Double lng;
    private Double lat;
    private String address;
}
