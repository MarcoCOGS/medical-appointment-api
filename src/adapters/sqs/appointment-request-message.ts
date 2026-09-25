import type { CountryISO, PendingAppointment } from '../../domain/appointment.js';

const INSURED_ID_PATTERN = /^[0-9]{5}$/;
const APPOINTMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidAppointmentRequestMessageError extends Error {
  constructor(readonly field: string) {
    super(`Mensaje SQS de solicitud inválido: ${field}.`);
    this.name = 'InvalidAppointmentRequestMessageError';
  }
}

function invalid(field: string): never {
  throw new InvalidAppointmentRequestMessageError(field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAppointmentRequestMessage(
  body: string | undefined,
  expectedCountry: CountryISO,
): PendingAppointment {
  if (typeof body !== 'string') invalid('body');

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    invalid('body');
  }

  if (!isRecord(value)) invalid('body');
  if (value.eventType !== 'appointment.requested') invalid('eventType');
  if (value.schemaVersion !== 1) invalid('schemaVersion');
  if (typeof value.appointmentId !== 'string'
    || !APPOINTMENT_ID_PATTERN.test(value.appointmentId)) invalid('appointmentId');
  if (typeof value.insuredId !== 'string'
    || !INSURED_ID_PATTERN.test(value.insuredId)) invalid('insuredId');
  if (typeof value.scheduleId !== 'number'
    || !Number.isSafeInteger(value.scheduleId)
    || value.scheduleId <= 0) invalid('scheduleId');
  if (value.countryISO !== expectedCountry) invalid('countryISO');
  if (value.status !== 'pending') invalid('status');
  if (typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || new Date(value.createdAt).toISOString() !== value.createdAt) invalid('createdAt');

  return {
    appointmentId: value.appointmentId,
    insuredId: value.insuredId,
    scheduleId: value.scheduleId,
    countryISO: expectedCountry,
    status: 'pending',
    createdAt: value.createdAt,
  };
}
