package com.example.tongxinproject;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.example.tongxinproject.mapper")
public class TongxinProjectApplication {

    public static void main(String[] args) {
        SpringApplication.run(TongxinProjectApplication.class, args);
    }

}
