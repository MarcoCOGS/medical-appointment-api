import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PutEventsCommand, type EventBridgeClient } from '@aws-sdk/client-eventbridge';
import {
  AppointmentResultPublishError,
  EventBridgeAppointmentResultPublisher,
} from '../src/adapters/eventbridge/appointment-result-publisher.js';
import type { CountryAppointmentOutcome } from '../src/domain/appointment.js';

const busArn = 'arn:aws:events:us-east-1:123456789012:event-bus/appointments';
const completed: CountryAppointmentOutcome = {
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'completed',
  createdAt: '2026-09-24T15:00:00.000Z',
};

function fakeClient(send: (command: unknown) => Promise<unknown>): EventBridgeClient {
  return { send } as unknown as EventBridgeClient;
}

describe('EventBridgeAppointmentResultPublisher', () => {
  for (const outcome of [
    completed,
    { ...completed, countryISO: 'CL', status: 'rejected', rejectionReason: 'SLOT_UNAVAILABLE' } as const,
  ]) {
    it(`publica ${outcome.status} de ${outcome.countryISO} con identidad estable`, async () => {
      let published: PutEventsCommand | undefined;
      const client = fakeClient(async (command) => {
        assert.ok(command instanceof PutEventsCommand);
        published = command;
        return { FailedEntryCount: 0, Entries: [{ EventId: 'event-id' }] };
      });
      await new EventBridgeAppointmentResultPublisher(busArn, client).publish(outcome);

      assert.ok(published);
      const entry = published.input.Entries?.[0];
      assert.equal(entry?.EventBusName, busArn);
      assert.equal(entry?.Source, 'medical.appointments');
      assert.equal(entry?.DetailType, 'AppointmentProcessed');
      assert.deepEqual(JSON.parse(entry?.Detail ?? ''), {
        eventType: 'appointment.processed',
        schemaVersion: 1,
        ...outcome,
      });
    });
  }

  it('falla si PutEvents informa un error por entrada aunque el SDK responda', async () => {
    const client = fakeClient(async () => ({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'InternalFailure' }],
    }));
    await assert.rejects(
      new EventBridgeAppointmentResultPublisher(busArn, client).publish(completed),
      AppointmentResultPublishError,
    );
  });

  it('falla si EventBridge no devuelve EventId para la entrada', async () => {
    const client = fakeClient(async () => ({ FailedEntryCount: 0, Entries: [{}] }));
    await assert.rejects(
      new EventBridgeAppointmentResultPublisher(busArn, client).publish(completed),
      AppointmentResultPublishError,
    );
  });
});
