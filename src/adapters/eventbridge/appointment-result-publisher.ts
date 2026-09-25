import { PutEventsCommand, type EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { AppointmentResultPublisher } from '../../application/ports/appointment-result-publisher.js';
import type { CountryAppointmentOutcome } from '../../domain/appointment.js';

export class AppointmentResultPublishError extends Error {
  constructor() {
    super('EventBridge no confirmó la publicación de la decisión.');
    this.name = 'AppointmentResultPublishError';
  }
}

export class EventBridgeAppointmentResultPublisher implements AppointmentResultPublisher {
  constructor(
    private readonly busArn: string,
    private readonly client: EventBridgeClient,
  ) {}

  async publish(outcome: CountryAppointmentOutcome): Promise<void> {
    const response = await this.client.send(new PutEventsCommand({
      Entries: [{
        EventBusName: this.busArn,
        Source: 'medical.appointments',
        DetailType: 'AppointmentProcessed',
        Detail: JSON.stringify({
          eventType: 'appointment.processed',
          schemaVersion: 1,
          appointmentId: outcome.appointmentId,
          insuredId: outcome.insuredId,
          scheduleId: outcome.scheduleId,
          countryISO: outcome.countryISO,
          status: outcome.status,
          createdAt: outcome.createdAt,
          ...(outcome.status === 'rejected'
            ? { rejectionReason: outcome.rejectionReason }
            : {}),
        }),
      }],
    }));

    if (response.FailedEntryCount !== 0 || !response.Entries?.[0]?.EventId) {
      throw new AppointmentResultPublishError();
    }
  }
}
