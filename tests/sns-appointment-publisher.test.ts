import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import { SnsAppointmentPublisher } from '../src/adapters/sns/appointment-publisher.js';
import type { PendingAppointment } from '../src/domain/appointment.js';

function fakeClient(send: (command: unknown) => Promise<unknown>): SNSClient {
  return { send } as unknown as SNSClient;
}

describe('SnsAppointmentPublisher', () => {
  for (const countryISO of ['PE', 'CL'] as const) {
    it('enruta ' + countryISO + ' y conserva appointmentId para reintentos', async () => {
      let published: PublishCommand | undefined;
      const client = fakeClient(async (command) => {
        assert.ok(command instanceof PublishCommand);
        published = command;
        return { MessageId: 'sns-message-id' };
      });
      const appointment: PendingAppointment = {
        appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
        insuredId: '00123',
        scheduleId: 100,
        countryISO,
        status: 'pending',
        createdAt: '2026-09-24T15:00:00.000Z',
      };

      await new SnsAppointmentPublisher('arn:aws:sns:us-east-1:123456789012:requests', client)
        .publish(appointment);

      assert.ok(published);
      assert.equal(published.input.TopicArn, 'arn:aws:sns:us-east-1:123456789012:requests');
      assert.equal(published.input.MessageAttributes?.countryISO?.StringValue, countryISO);
      assert.deepEqual(JSON.parse(published.input.Message ?? ''), {
        eventType: 'appointment.requested',
        schemaVersion: 1,
        ...appointment,
      });
    });
  }
});
