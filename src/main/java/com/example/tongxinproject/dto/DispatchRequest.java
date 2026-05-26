package com.example.tongxinproject.dto;

import lombok.Data;
import java.util.List;

@Data
public class DispatchRequest {
    private Incident incident;
    private List<FenceVertex> fence;
    private List<PoliceUnitData> units;

    @Data
    public static class Incident {
        private double lng;
        private double lat;
    }

    @Data
    public static class FenceVertex {
        private double lng;
        private double lat;
    }

    @Data
    public static class PoliceUnitData {
        private String unitId;
        private String name;
        private boolean available;
        private double lng;
        private double lat;
        private String policeType;
        private String transportMode;
    }
}
