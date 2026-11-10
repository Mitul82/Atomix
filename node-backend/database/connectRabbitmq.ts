/*
    * RabbitMQ relies on an Exchange, Binding, and Queue topology:
    * • Producers do not send messages directly to a queue; they send them to an Exchange.
 
    * • The Exchange inspects the message (using attributes or routing keys) and routes it to one or more Queues
    * based on rules called Bindings. Types of exchanges include Direct, Fanout, Topic, and Headers.

    * • Consumers listen to queues and process messages, sending an acknowledgment (ack) back to the broker once done.
    * If a consumer crashes before acking, RabbitMQ redelivers the message.
*/

import amqp, { type ChannelModel, type Channel } from 'amqplib';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

const connectRabbitMQ = async (url: string): Promise<Channel> => {
    if(channel) {
        return channel;
    }

    connection = await amqp.connect(url);
    channel = await connection.createChannel();

    connection.on('error', (err: unknown) => {
        console.error('[NODE BACKEND] Error in rabbitmq connection: ', err);
    });

    channel.on('error', (err) => {
        console.error('[NODE BACKEND] Error in rabbitmq channel: ', err);
    });

    channel.on('close', async () => {
        await connection?.close();
    });

    return channel;
}

export const getChannel = (): Channel => {
    if(!channel) {
        throw Error('[NODE BACKEND] Rabbitmq channel not initialized');
    }

    return channel;
}

export default connectRabbitMQ;