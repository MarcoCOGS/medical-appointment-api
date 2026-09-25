import { z } from 'zod';
import type { CountryAppointmentOutcome } from '../../domain/appointment.js';
import {
  appointmentIdSchema,
  countryIsoSchema,
  createdAtSchema,
  firstIssueField,
  insuredIdSchema,
  scheduleIdSchema,
} from '../validation/appointment-schemas.js';

const detailFields = {
  eventType: z.literal('appointment.processed'),
  schemaVersion: z.literal(1),
  appointmentId: appointmentIdSchema,
  insuredId: insuredIdSchema,
  scheduleId: scheduleIdSchema,
  countryISO: countryIsoSchema,
  createdAt: createdAtSchema,
};

const confirmationSchema = z.object({
  source: z.literal('medical.appointments'),
  'detail-type': z.literal('AppointmentProcessed'),
  detail: z.object({
    ...detailFields,
    status: z.enum(['completed', 'rejected']),
    rejectionReason: z.unknown().optional(),
  }),
});
const noRejectionReasonSchema = z.never().optional();
const rejectionReasonSchema = z.enum(['SLOT_NOT_FOUND', 'SLOT_UNAVAILABLE']);

export class InvalidAppointmentConfirmationMessageError extends Error {
  constructor(readonly field: string) {
    super(`Mensaje SQS de confirmación inválido: ${field}.`);
    this.name = 'InvalidAppointmentConfirmationMessageError';
  }
}

function invalid(field: string): never {
  throw new InvalidAppointmentConfirmationMessageError(field);
}

export function parseAppointmentConfirmationMessage(
  body: string | undefined,
): CountryAppointmentOutcome {
  if (typeof body !== 'string') invalid('body');

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    invalid('body');
  }

  const result = confirmationSchema.safeParse(value);
  if (!result.success) invalid(firstIssueField(result.error));

  const detail = result.data.detail;
  const base = {
    appointmentId: detail.appointmentId,
    insuredId: detail.insuredId,
    scheduleId: detail.scheduleId,
    countryISO: detail.countryISO,
    createdAt: detail.createdAt,
  };

  if (detail.status === 'completed') {
    if (!noRejectionReasonSchema.safeParse(detail.rejectionReason).success) {
      invalid('detail.rejectionReason');
    }
    return { ...base, status: 'completed' };
  }

  const reason = rejectionReasonSchema.safeParse(detail.rejectionReason);
  if (!reason.success) invalid('detail.rejectionReason');
  return { ...base, status: 'rejected', rejectionReason: reason.data };
}
