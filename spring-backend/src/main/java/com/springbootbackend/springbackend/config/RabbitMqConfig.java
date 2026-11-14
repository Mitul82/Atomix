package com.springbootbackend.springbackend.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMqConfig {
    public static final String exchangeName = "atomix.exchange";
    public static final String queueName = "reservation.queue";
    public static final String routingKey = "reservation.created";

    public static final String dlqExhange = "atomix.dlx";
    public static final String dlqQueue = "reservation.dlx";
    public static final String dlqRoutingKey = "reservation.dql.key";

    @Bean
    public DirectExchange atomixExchange() {
        return new DirectExchange(exchangeName, true, false);
    }

    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange(dlqExhange, true, false);
    }

    @Bean
    public Queue reservationQueue() {
        return QueueBuilder.durable(queueName)
            .withArgument("x-dead-letter-exchange", dlqExhange)
            .withArgument("x-dead-letter-routing-key", dlqRoutingKey)
            .build();
    }

    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable(dlqQueue).build();
    }

    @Bean
    public Binding reservationBinding(Queue reservationQueue, DirectExchange atomixExchange) {
        return BindingBuilder.bind(reservationQueue).to(atomixExchange).with(routingKey);
    }

    @Bean Binding deadLetterBindinf(Queue deadLetterQueue, DirectExchange deadLetterExchange) {
        return BindingBuilder.bind(deadLetterQueue).to(deadLetterExchange).with(dlqRoutingKey);
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}