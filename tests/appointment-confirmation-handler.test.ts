import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAppointmentEntrypoint } from '../src/adapters/lambda/appointment-entrypoint.js';
import { createAppointmentConfirmationHandler } from '../src/adapters/sqs/appointment-confirmation-handler.js';
import type { CountryAppointmentOutcome } from '../src/domain/appointment.js';

const detail = {
  eventType: 'appointment.processed',
  schemaVersion: 1,
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'completed',
  createdAt: '2026-09-24T15:00:00.000Z',
} as const;
const sqsEvent = {
  Records: [{
    messageId: 'sqs-1',
    body: JSON.stringify({
      source: 'medical.appointments',
      'detail-type': 'AppointmentProcessed',
      detail,
    }),
  }],
};

describe('confirmación SQS en appointment', () => {
  it('confirma la decisión y registra el resultado sin insuredId', async () => {
    let passed: CountryAppointmentOutcome | undefined;
    const logs: Record<string, unknown>[] = [];
    const handler = createAppointmentConfirmationHandler(
      { async execute(outcome) { passed = outcome; return 'updated'; } },
      (entry) => logs.push(entry),
    );
    await handler(sqsEvent);
    assert.deepEqual(passed, {
      appointmentId: detail.appointmentId,
      insuredId: '00123',
      scheduleId: 100,
      countryISO: 'PE',
      status: 'completed',
      createdAt: detail.createdAt,
    });
    assert.deepEqual(logs, [{
      event: 'appointment.confirmed',
      appointmentId: detail.appointmentId,
      countryISO: 'PE',
      status: 'completed',
      result: 'updated',
    }]);
  });

  it('propaga un fallo de DynamoDB para que SQS reintente', async () => {
    const failure = new Error('DynamoDB temporalmente no disponible');
    const handler = createAppointmentConfirmationHandler(
      { async execute() { throw failure; } },
    );
    await assert.rejects(handler(sqsEvent), (error: unknown) => error === failure);
  });

  it('dirige HTTP y SQS a los adaptadores correctos', async () => {
    const calls: string[] = [];
    const entrypoint = createAppointmentEntrypoint(
      async () => {
        calls.push('http');
        return { statusCode: 200, headers: {}, body: '{}' };
      },
      async () => { calls.push('sqs'); },
    );
    const httpResponse = await entrypoint({ routeKey: 'GET /appointments/{insuredId}' });
    const sqsResponse = await entrypoint(sqsEvent);
    assert.equal(httpResponse?.statusCode, 200);
    assert.equal(sqsResponse, undefined);
    assert.deepEqual(calls, ['http', 'sqs']);
  });
});
