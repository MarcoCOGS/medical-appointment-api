import { z } from 'zod';
import type { CountryISO, PendingAppointment } from '../../domain/appointment.js';
import {
  appointmentIdSchema,
  createdAtSchema,
  firstIssueField,
  insuredIdSchema,
  scheduleIdSchema,
} from '../validation/appointment-schemas.js';

function messageSchema(countryISO: CountryISO) {
  return z.object({
    eventType: z.literal('appointment.requested'),
    schemaVersion: z.literal(1),
    appointmentId: appointmentIdSchema,
    insuredId: insuredIdSchema,
    scheduleId: scheduleIdSchema,
    countryISO: z.literal(countryISO),
    status: z.literal('pending'),
    createdAt: createdAtSchema,
  });
}

const requestMessageSchemas = {
  PE: messageSchema('PE'),
  CL: messageSchema('CL'),
};

export class InvalidAppointmentRequestMessageError extends Error {
  constructor(readonly field: string) {
    super(`Mensaje SQS de solicitud inválido: ${field}.`);
    this.name = 'InvalidAppointmentRequestMessageError';
  }
}

function invalid(field: string): never {
  throw new InvalidAppointmentRequestMessageError(field);
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

  const result = requestMessageSchemas[expectedCountry].safeParse(value);
  if (!result.success) invalid(firstIssueField(result.error));

  const { appointmentId, insuredId, scheduleId, countryISO, status, createdAt } = result.data;
  return { appointmentId, insuredId, scheduleId, countryISO, status, createdAt };
}
