import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InvalidAppointmentConfirmationMessageError,
  parseAppointmentConfirmationMessage,
} from '../src/adapters/sqs/appointment-confirmation-message.js';

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

function envelope(value: unknown): string {
  return JSON.stringify({
    version: '0',
    id: 'event-id',
    source: 'medical.appointments',
    'detail-type': 'AppointmentProcessed',
    detail: value,
  });
}

function assertInvalid(body: string | undefined, field: string): void {
  assert.throws(
    () => parseAppointmentConfirmationMessage(body),
    (error: unknown) => error instanceof InvalidAppointmentConfirmationMessageError
      && error.field === field,
  );
}

describe('parseAppointmentConfirmationMessage', () => {
  it('lee una conformidad completed desde el sobre de EventBridge', () => {
    assert.deepEqual(parseAppointmentConfirmationMessage(envelope(detail)), {
      appointmentId: detail.appointmentId,
      insuredId: '00123',
      scheduleId: 100,
      countryISO: 'PE',
      status: 'completed',
      createdAt: detail.createdAt,
    });
  });

  it('lee un rechazo CL con su motivo', () => {
    assert.deepEqual(parseAppointmentConfirmationMessage(envelope({
      ...detail,
      countryISO: 'CL',
      status: 'rejected',
      rejectionReason: 'SLOT_NOT_FOUND',
    })), {
      appointmentId: detail.appointmentId,
      insuredId: '00123',
      scheduleId: 100,
      countryISO: 'CL',
      status: 'rejected',
      rejectionReason: 'SLOT_NOT_FOUND',
      createdAt: detail.createdAt,
    });
  });

  it('rechaza sobres incorrectos y versiones incompatibles', () => {
    assertInvalid(undefined, 'body');
    assertInvalid('{', 'body');
    assertInvalid(envelope(null), 'detail');
    assertInvalid(JSON.stringify({ source: 'otro', 'detail-type': 'AppointmentProcessed', detail }), 'source');
    assertInvalid(envelope({ ...detail, schemaVersion: 2 }), 'detail.schemaVersion');
    assertInvalid(envelope({ ...detail, eventType: 'otro', status: 'pending' }), 'detail.eventType');
  });

  it('rechaza una identidad o decisión inválida', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...detail, appointmentId: 'no-uuid' }, 'detail.appointmentId'],
      [{ ...detail, insuredId: 123 }, 'detail.insuredId'],
      [{ ...detail, scheduleId: 0 }, 'detail.scheduleId'],
      [{ ...detail, countryISO: 'AR' }, 'detail.countryISO'],
      [{ ...detail, status: 'pending' }, 'detail.status'],
      [{ ...detail, status: 'rejected' }, 'detail.rejectionReason'],
      [{ ...detail, rejectionReason: 'SLOT_NOT_FOUND' }, 'detail.rejectionReason'],
    ];
    for (const [candidate, field] of cases) {
      assertInvalid(envelope(candidate), field);
    }
  });
});
