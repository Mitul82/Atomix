package com.springbootbackend.springbackend.config;

import org.springframework.amqp.core.*;
import tools.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;


@Configuration
public class RabbitMqConfig {
    public static final String exchangeName = "atomix.exchange";
    public static final String queueName = "reservation.queue";
    public static final String routingKey = "reservation.created";

    @Bean
    public DirectExchange atomixExchange() {
        return new DirectExchange(exchangeName, true, false);
    }

    @Bean
    public Queue reservationQueue() {
        return QueueBuilder.durable(queueName).build();
    }

    @Bean
    public Binding reservationBinding(Queue reservationQueue, DirectExchange atomixExchange) {
        return BindingBuilder.bind(reservationQueue).to(atomixExchange).with(routingKey);
    }

    @Bean
    public ObjectMapper obectMapper() {
        return new ObjectMapper();
    }

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/**")
                    .allowedOriginPatterns("*")
                    .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                    .allowedHeaders("*");
            }
        };
    }
}