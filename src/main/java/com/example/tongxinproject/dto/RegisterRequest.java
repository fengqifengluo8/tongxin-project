package com.example.tongxinproject.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class RegisterRequest {
    @NotBlank(message = "用户名不能为空")
    @Size(min = 2, max = 50, message = "用户名长度应为2-50个字符")
    private String username;

    @NotBlank(message = "密码不能为空")
    @Size(min = 6, max = 100, message = "密码长度应为6-100个字符")
    private String password;

    @NotBlank(message = "角色不能为空")
    @Pattern(regexp = "commander|officer|guest", message = "角色必须是commander、officer或guest")
    private String role;

    @Size(max = 50, message = "昵称长度不能超过50个字符")
    private String nickname;
}
