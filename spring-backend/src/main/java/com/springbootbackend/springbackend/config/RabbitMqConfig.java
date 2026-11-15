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

    public static final String dlqExchange = "atomix.dlx";
    public static final String dlqQueue = "reservation.dlq";
    public static final String dlqRoutingKey = "reservation.dead";
    public static final String parkingQueue = "reservation.parking-lot";
    public static final String parkingRoutingKey = "reservation.parked";

    @Bean DirectExchange atomixExchange() {
        return new DirectExchange(exchangeName, true, false);
    }

    @Bean DirectExchange deadLetterExchange() {
        return new DirectExchange(dlqExchange, true, false);
    }

    @Bean Queue reservationQueue() {
        return QueueBuilder.durable(queueName)
            .withArgument("x-dead-letter-exchange", dlqExchange)
            .withArgument("x-dead-letter-routing-key", dlqRoutingKey).build();
    }
    @Bean Queue deadLetterQueue() {
        return QueueBuilder.durable(dlqQueue)
            .withArgument("x-dead-letter-exchange", dlqExchange)
            .withArgument("x-dead-letter-routing-key", parkingRoutingKey).build();
    }
    @Bean Queue parkingLotQueue() { return QueueBuilder.durable(parkingQueue).build(); }

    @Bean Binding reservationBinding(Queue reservationQueue, DirectExchange atomixExchange) {
        return BindingBuilder.bind(reservationQueue).to(atomixExchange).with(routingKey);
    }
    @Bean Binding deadLetterBinding(Queue deadLetterQueue, DirectExchange deadLetterExchange) {
        return BindingBuilder.bind(deadLetterQueue).to(deadLetterExchange).with(dlqRoutingKey);
    }
    @Bean Binding parkingBinding(Queue parkingLotQueue, DirectExchange deadLetterExchange) {
        return BindingBuilder.bind(parkingLotQueue).to(deadLetterExchange).with(parkingRoutingKey);
    }

    @Bean MessageConverter jsonMessageConverter() {
        return new JacksonJsonMessageConverter();
    }
}