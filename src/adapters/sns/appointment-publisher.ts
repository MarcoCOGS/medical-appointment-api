import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { AppointmentPublisher } from '../../application/ports/appointment-publisher.js';
import type { PendingAppointment } from '../../domain/appointment.js';

export class SnsAppointmentPublisher implements AppointmentPublisher {
  constructor(
    private readonly topicArn: string,
    private readonly client: SNSClient,
  ) {}

  async publish(appointment: PendingAppointment): Promise<void> {
    await this.client.send(new PublishCommand({
      TopicArn: this.topicArn,
      Message: JSON.stringify({
        eventType: 'appointment.requested',
        schemaVersion: 1,
        appointmentId: appointment.appointmentId,
        insuredId: appointment.insuredId,
        scheduleId: appointment.scheduleId,
        countryISO: appointment.countryISO,
        status: appointment.status,
        createdAt: appointment.createdAt,
      }),
      MessageAttributes: {
        countryISO: {
          DataType: 'String',
          StringValue: appointment.countryISO,
        },
      },
    }));
  }
}
