import type { Channel } from 'amqplib';

// * The unique identifier or name of the exchange where producers publish messages
// *  Acts as the message-routing hub. Producers never send messages directly to a queue; instead, they send them to an
// * exchange name. The exchange receives the message and decides how to distribute it based on its exchange type
// * (direct, topic, fanout, or headers) and existing bindings
export const exchangeName = 'atomix.exchange';

// * The unique identifier or name of the queue where messages are actually stored (e.g., email_notifications, billing.order-created)
// * Acts as a buffer that holds messages safely until a consumer application picks them up and processes them. Queues are bound to
// * exchanges using rules (bindings). Once an exchange matches a message's routing key to a queue's binding, a copy of the message
// * is placed into that queue.
export const queueName = 'reservation.queue';

// * A string attribute (label) attached to a message by the producer when it is published (e.g., order.created, payment.failed, or email)
/* 
    * Acts as a hint or address tag that the exchange reads. How it is used depends on the exchange type:
        * • Direct Exchange: Routes the message only to queues whose binding key exact-matches the routing key.
        * • Topic Exchange: Routes the message using pattern/wildcard matches (like order.* or *.failed).
        * • Fanout Exchange: Ignores the routing key entirely and sends the message to every bound queue
*/
export const routingKey = 'reservation.created';

const initReservationQueue = async (channel: Channel): Promise<void> => {
    await channel.assertExchange(exchangeName, 'direct', { durable: true });

    await channel.assertQueue(queueName, { durable: true });

    await channel.bindQueue(queueName, exchangeName, routingKey);

    console.log('[NODE BACKEND] Reservation queue created');
}

export default initReservationQueue;