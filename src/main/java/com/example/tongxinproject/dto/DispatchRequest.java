package com.example.tongxinproject.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.Data;
import java.util.List;

@Data
public class DispatchRequest {
    @NotNull(message = "事件信息不能为空")
    @Valid
    private Incident incident;

    @NotEmpty(message = "围栏顶点不能为空")
    private List<@Valid FenceVertex> fence;

    @NotEmpty(message = "警力列表不能为空")
    private List<@Valid PoliceUnitData> units;

    @Data
    public static class Incident {
        @NotNull(message = "事件经度不能为空")
        @DecimalMin(value = "-180.0", message = "经度必须在-180到180之间")
        @DecimalMax(value = "180.0", message = "经度必须在-180到180之间")
        private Double lng;

        @NotNull(message = "事件纬度不能为空")
        @DecimalMin(value = "-90.0", message = "纬度必须在-90到90之间")
        @DecimalMax(value = "90.0", message = "纬度必须在-90到90之间")
        private Double lat;
    }

    @Data
    public static class FenceVertex {
        @NotNull(message = "围栏顶点经度不能为空")
        @DecimalMin(value = "-180.0")
        @DecimalMax(value = "180.0")
        private Double lng;

        @NotNull(message = "围栏顶点纬度不能为空")
        @DecimalMin(value = "-90.0")
        @DecimalMax(value = "90.0")
        private Double lat;
    }

    @Data
    public static class PoliceUnitData {
        @NotBlank(message = "警力编号不能为空")
        private String unitId;

        @NotBlank(message = "警力名称不能为空")
        @Size(max = 100, message = "名称长度不能超过100个字符")
        private String name;

        private Boolean available; // 包装类型，JSON缺字段时为null（调用方应明确设置）

        @NotNull(message = "警力经度不能为空")
        @DecimalMin(value = "-180.0")
        @DecimalMax(value = "180.0")
        private Double lng;

        @NotNull(message = "警力纬度不能为空")
        @DecimalMin(value = "-90.0")
        @DecimalMax(value = "90.0")
        private Double lat;

        private String policeType;

        @Pattern(regexp = "步行|骑行|开车", message = "交通方式必须为步行、骑行或开车")
        private String transportMode;
    }
}
