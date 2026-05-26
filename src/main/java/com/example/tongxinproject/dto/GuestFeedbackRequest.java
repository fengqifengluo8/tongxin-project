package com.example.tongxinproject.dto;

import lombok.Data;

@Data
public class GuestFeedbackRequest {
    private String vague;
    private String text;
    private Double lng;
    private Double lat;
    private String address;
}
