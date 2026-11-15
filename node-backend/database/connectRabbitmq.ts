/*
    * RabbitMQ relies on an Exchange, Binding, and Queue topology:
    * • Producers do not send messages directly to a queue; they send them to an Exchange.
 
    * • The Exchange inspects the message (using attributes or routing keys) and routes it to one or more Queues
    * based on rules called Bindings. Types of exchanges include Direct, Fanout, Topic, and Headers.

    * • Consumers listen to queues and process messages, sending an acknowledgment (ack) back to the broker once done.
    * If a consumer crashes before acking, RabbitMQ redelivers the message.
*/
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';

import initReservationQueue from '#/queues/reservationQueue.js';

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;
let rabbitUrl = '';
let shuttingDown = false;
let reconnectScheduled = false;

const returnedIds = new Set<string>();

export const wasReturned = (messageId: string): boolean => returnedIds.delete(messageId);

const scheduleReconnect = () => {
    if (reconnectScheduled || shuttingDown) {
        return
    }

    reconnectScheduled = true;

    const attempt = async () => {
        if (shuttingDown) {
            return
        }

        try {
            await connectRabbitMQ(rabbitUrl);

            reconnectScheduled = false;

            console.log('[NODE BACKEND] RabbitMQ reconnected');
        } catch (err: unknown) {
            console.error('[NODE BACKEND] RabbitMQ reconnect failed, retrying: ', err);

            setTimeout(attempt, 2000);
        }
    }

    setTimeout(attempt, 2000);
}

const handleLost = (conn: ChannelModel) => {
    if (shuttingDown || connection !== conn) {
        return
    }

    connection = null;

    channel = null;

    conn.close().catch(() => {});

    scheduleReconnect();
}

const connectRabbitMQ = async (url: string): Promise<ConfirmChannel> => {
    if (channel) {
        return channel
    }

    rabbitUrl = url;

    const conn = await amqp.connect(url);

    try {
        const ch = await conn.createConfirmChannel();

        await initReservationQueue(ch);

        conn.on('error', (err: unknown) => console.error('[NODE BACKEND] Error in rabbitmq connection: ', err));

        conn.on('close', () => handleLost(conn));

        ch.on('error', (err: unknown) => console.error('[NODE BACKEND] Error in rabbitmq channel: ', err));

        ch.on('close', () => handleLost(conn));

        ch.on('return', (msg: { properties: { messageId?: string } }) => {
            const id = msg.properties.messageId;

            if (!id) {
                return
            }

            if (returnedIds.size > 10_000) {
                returnedIds.clear();
            }

            returnedIds.add(id);
        });

        connection = conn;

        channel = ch;

        return ch;
    } catch (err: unknown) {
        conn.close().catch(() => {});

        throw err;
    }
}

export const getChannel = (): ConfirmChannel => {
    if (!channel) throw Error('[NODE BACKEND] Rabbitmq channel not initialized');
    return channel;
}

export const closeRabbitMQ = async (): Promise<void> => {
    shuttingDown = true;
    const ch = channel;
    const conn = connection;
    channel = null;
    connection = null;
    try { await ch?.close(); } catch { /* already closed */ }
    try { await conn?.close(); } catch { /* already closed */ }
}

export default connectRabbitMQ;