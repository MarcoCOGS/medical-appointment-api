import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCountryAppointmentHandler } from '../src/adapters/sqs/country-appointment-handler.js';
import type { CountryAppointmentOutcome } from '../src/application/use-cases/register-country-appointment.js';
import type { PendingAppointment } from '../src/domain/appointment.js';

const message = {
  eventType: 'appointment.requested',
  schemaVersion: 1,
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'pending',
  createdAt: '2026-09-24T15:00:00.000Z',
} as const;

const sqsEvent = (body: unknown) => ({
  Records: [{ messageId: 'sqs-message-1', body: JSON.stringify(body) }],
});

describe('handler SQS de país', () => {
  it('PE procesa su mensaje y registra un log sin insuredId', async () => {
    let passed: PendingAppointment | undefined;
    const logs: Record<string, unknown>[] = [];
    const handler = createCountryAppointmentHandler(
      'PE',
      { async execute(appointment): Promise<CountryAppointmentOutcome> {
        passed = appointment;
        return { ...appointment, status: 'completed' };
      } },
      (entry) => logs.push(entry),
    );

    await handler(sqsEvent(message));
    assert.deepEqual(passed, {
      appointmentId: message.appointmentId,
      insuredId: '00123',
      scheduleId: 100,
      countryISO: 'PE',
      status: 'pending',
      createdAt: message.createdAt,
    });
    assert.deepEqual(logs, [{
      event: 'appointment.country_decision',
      appointmentId: message.appointmentId,
      countryISO: 'PE',
      status: 'completed',
    }]);
  });

  it('CL procesa solo sus mensajes y conserva el motivo de rechazo', async () => {
    const logs: Record<string, unknown>[] = [];
    const handler = createCountryAppointmentHandler(
      'CL',
      { async execute(appointment) {
        return { ...appointment, status: 'rejected', rejectionReason: 'SLOT_UNAVAILABLE' };
      } },
      (entry) => logs.push(entry),
    );

    await handler(sqsEvent({ ...message, countryISO: 'CL' }));
    assert.deepEqual(logs, [{
      event: 'appointment.country_decision',
      appointmentId: message.appointmentId,
      countryISO: 'CL',
      status: 'rejected',
      rejectionReason: 'SLOT_UNAVAILABLE',
    }]);
  });

  it('rechaza un mensaje enviado a la cola equivocada antes de registrar', async () => {
    const handler = createCountryAppointmentHandler(
      'CL',
      { async execute() { assert.fail('No debe ejecutarse el caso de uso'); } },
      () => assert.fail('No debe registrarse una decisión'),
    );
    await assert.rejects(handler(sqsEvent(message)), /countryISO/);
  });

  it('propaga el fallo de MySQL para que SQS reintente el mensaje', async () => {
    const failure = new Error('MySQL temporalmente no disponible');
    const handler = createCountryAppointmentHandler(
      'PE',
      { async execute() { throw failure; } },
      () => assert.fail('No debe registrarse una decisión'),
    );
    await assert.rejects(handler(sqsEvent(message)), (error: unknown) => error === failure);
  });

  it('no acepta un evento SQS vacío', async () => {
    const handler = createCountryAppointmentHandler(
      'PE',
      { async execute() { assert.fail('No debe ejecutarse'); } },
    );
    await assert.rejects(handler({ Records: [] }), /no contiene registros/);
  });
});
