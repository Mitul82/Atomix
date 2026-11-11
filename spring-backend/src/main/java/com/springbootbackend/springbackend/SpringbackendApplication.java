package com.springbootbackend.springbackend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SpringbackendApplication {
	public static void main(String[] args) {
		SpringApplication.run(SpringbackendApplication.class, args);
	}
}