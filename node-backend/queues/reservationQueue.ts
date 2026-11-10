import type { Channel } from 'amqplib';

export const exchangeName = 'atomix.exchange';
export const queueName = 'reservation.queue';
export const routingKey = 'reservation.created';

const initReservationQueue = async (channel: Channel): Promise<void> => {
    await channel.assertExchange(exchangeName, 'direct', { durable: true });

    await channel.assertQueue(queueName, { durable: true });

    await channel.bindQueue(queueName, exchangeName, routingKey);

    console.log('[NODE BACKEND] Reservation queue created');
}

export default initReservationQueue;