import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InvalidAppointmentRequestMessageError,
  parseAppointmentRequestMessage,
} from '../src/adapters/sqs/appointment-request-message.js';

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

function assertInvalid(body: string | undefined, country: 'PE' | 'CL', field: string): void {
  assert.throws(
    () => parseAppointmentRequestMessage(body, country),
    (error: unknown) => error instanceof InvalidAppointmentRequestMessageError
      && error.field === field,
  );
}

describe('parseAppointmentRequestMessage', () => {
  it('lee el JSON crudo de SNS para PE y conserva insuredId como texto', () => {
    assert.deepEqual(parseAppointmentRequestMessage(JSON.stringify(message), 'PE'), {
      appointmentId: message.appointmentId,
      insuredId: '00123',
      scheduleId: 100,
      countryISO: 'PE',
      status: 'pending',
      createdAt: message.createdAt,
    });
  });

  it('acepta CL solo en el procesador de CL', () => {
    const body = JSON.stringify({ ...message, countryISO: 'CL' });
    assert.equal(parseAppointmentRequestMessage(body, 'CL').countryISO, 'CL');
    assertInvalid(body, 'PE', 'countryISO');
    assertInvalid(JSON.stringify({ ...message, countryISO: 'CL', status: 'completed' }), 'PE', 'countryISO');
  });

  it('rechaza cuerpos ausentes, JSON inválido y el sobre SNS no configurado como raw', () => {
    assertInvalid(undefined, 'PE', 'body');
    assertInvalid('{', 'PE', 'body');
    assertInvalid(JSON.stringify({ Message: JSON.stringify(message) }), 'PE', 'eventType');
  });

  it('rechaza cambios de contrato e identidad antes de tocar la base', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...message, schemaVersion: 2 }, 'schemaVersion'],
      [{ ...message, appointmentId: 'invalid' }, 'appointmentId'],
      [{ ...message, insuredId: 123 }, 'insuredId'],
      [{ ...message, scheduleId: 0 }, 'scheduleId'],
      [{ ...message, status: 'completed' }, 'status'],
      [{ ...message, createdAt: 'ayer' }, 'createdAt'],
    ];
    for (const [candidate, field] of cases) {
      assertInvalid(JSON.stringify(candidate), 'PE', field);
    }
  });
});
