import { getChannel, wasReturned } from '#/database/connectRabbitmq.js';
import { exchangeName, routingKey } from '#/queues/reservationQueue.js';

export type PublishOutcome = 'CONFIRMED' | 'REJECTED' | 'UNKNOWN';

const confirmTimeout = 2000;

const publishReservation = (reservationId: string, body: Buffer): Promise<PublishOutcome> => {
    return new Promise((resolve) => {
        let settled = false;

        const settle = (outcome: PublishOutcome) => {
            if (settled) {
                return;
            }

            settled = true;

            clearTimeout(timer);

            resolve(outcome);
        }

        const timer = setTimeout(() => settle('UNKNOWN'), confirmTimeout);

        try {
            getChannel().publish(exchangeName, routingKey, body, {
                persistent: true,
                mandatory: true,
                messageId: reservationId,
                contentType: 'application/json',
                timestamp: Date.now()
            }, (err) => {
                if (err) {
                    return settle(err instanceof Error && /nack/i.test(err.message) ? 'REJECTED' : 'UNKNOWN');
                }

                settle(wasReturned(reservationId) ? 'REJECTED' : 'CONFIRMED');
            });
        } catch {
            settle('REJECTED');
        }
    });
}

export default publishReservation;