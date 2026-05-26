package com.example.tongxinproject.dto;

import lombok.Data;
import java.util.List;

@Data
public class DispatchResponse {
    private String mode;
    private String message;
    private boolean incidentInsideFence;
    private DispatchRequest.PoliceUnitData selectedUnit;
    private Double distanceKm;
    private List<String> candidatesInFence;
}
