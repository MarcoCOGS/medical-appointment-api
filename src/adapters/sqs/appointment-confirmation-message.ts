import type {
  CountryAppointmentOutcome,
  CountryISO,
  RejectionReason,
} from '../../domain/appointment.js';

const INSURED_ID_PATTERN = /^[0-9]{5}$/;
const APPOINTMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidAppointmentConfirmationMessageError extends Error {
  constructor(readonly field: string) {
    super(`Mensaje SQS de confirmación inválido: ${field}.`);
    this.name = 'InvalidAppointmentConfirmationMessageError';
  }
}

function invalid(field: string): never {
  throw new InvalidAppointmentConfirmationMessageError(field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAppointmentConfirmationMessage(
  body: string | undefined,
): CountryAppointmentOutcome {
  if (typeof body !== 'string') invalid('body');
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    invalid('body');
  }
  if (!isRecord(envelope)) invalid('body');
  if (envelope.source !== 'medical.appointments') invalid('source');
  if (envelope['detail-type'] !== 'AppointmentProcessed') invalid('detail-type');
  if (!isRecord(envelope.detail)) invalid('detail');

  const detail = envelope.detail;
  if (detail.eventType !== 'appointment.processed') invalid('detail.eventType');
  if (detail.schemaVersion !== 1) invalid('detail.schemaVersion');
  if (typeof detail.appointmentId !== 'string'
    || !APPOINTMENT_ID_PATTERN.test(detail.appointmentId)) invalid('detail.appointmentId');
  if (typeof detail.insuredId !== 'string'
    || !INSURED_ID_PATTERN.test(detail.insuredId)) invalid('detail.insuredId');
  if (typeof detail.scheduleId !== 'number'
    || !Number.isSafeInteger(detail.scheduleId)
    || detail.scheduleId <= 0) invalid('detail.scheduleId');
  if (detail.countryISO !== 'PE' && detail.countryISO !== 'CL') invalid('detail.countryISO');
  if (typeof detail.createdAt !== 'string'
    || !Number.isFinite(Date.parse(detail.createdAt))
    || new Date(detail.createdAt).toISOString() !== detail.createdAt) invalid('detail.createdAt');
  if (detail.status !== 'completed' && detail.status !== 'rejected') invalid('detail.status');

  const base = {
    appointmentId: detail.appointmentId,
    insuredId: detail.insuredId,
    scheduleId: detail.scheduleId,
    countryISO: detail.countryISO as CountryISO,
    createdAt: detail.createdAt,
  };
  if (detail.status === 'completed') {
    if (detail.rejectionReason !== undefined) invalid('detail.rejectionReason');
    return { ...base, status: 'completed' };
  }
  if (detail.rejectionReason !== 'SLOT_NOT_FOUND'
    && detail.rejectionReason !== 'SLOT_UNAVAILABLE') invalid('detail.rejectionReason');
  return {
    ...base,
    status: 'rejected',
    rejectionReason: detail.rejectionReason as RejectionReason,
  };
}
