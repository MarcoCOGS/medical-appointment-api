import { z } from 'zod';
import type { AppointmentRequest } from '../../domain/appointment.js';
import {
  countryIsoSchema,
  insuredIdSchema,
  scheduleIdSchema,
} from '../validation/appointment-schemas.js';

export interface ValidationIssue {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export interface ValidatedCreateAppointment {
  request: AppointmentRequest;
  idempotencyKey?: string;
}

const createAppointmentSchema = z.strictObject({
  insuredId: insuredIdSchema,
  scheduleId: scheduleIdSchema,
  countryISO: countryIsoSchema,
});
const idempotencyKeySchema = z.string().regex(/^[\x21-\x7E]{1,128}$/).optional();

const fieldMessages: Record<string, string> = {
  body: 'Debe ser un objeto JSON.',
  insuredId: 'Debe ser un texto de exactamente cinco dígitos.',
  scheduleId: 'Debe ser un entero positivo seguro.',
  countryISO: 'Debe ser PE o CL.',
};

function bodyIssues(error: z.ZodError): ValidationIssue[] {
  const unknownFields = error.issues.flatMap((issue) => issue.code === 'unrecognized_keys'
    ? issue.keys.map((field) => ({ field, message: 'Campo no permitido.' }))
    : []);
  const invalidFields = error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') return [];
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : 'body';
    return [{ field, message: fieldMessages[field] ?? issue.message }];
  });

  return [...unknownFields, ...invalidFields];
}

export function validateInsuredId(value: unknown): ValidationResult<string> {
  const result = insuredIdSchema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: [{ field: 'insuredId', message: fieldMessages.insuredId }] };
}

export function validateCreateAppointment(
  body: unknown,
  idempotencyKey?: unknown,
): ValidationResult<ValidatedCreateAppointment> {
  const request = createAppointmentSchema.safeParse(body);
  if (!request.success && request.error.issues.some((issue) => issue.code === 'invalid_type' && issue.path.length === 0)) {
    return { ok: false, issues: bodyIssues(request.error) };
  }

  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  const issues: ValidationIssue[] = [
    ...(!request.success ? bodyIssues(request.error) : []),
    ...(!key.success ? [{
      field: 'Idempotency-Key',
      message: 'Debe tener entre 1 y 128 caracteres ASCII visibles, sin espacios.',
    }] : []),
  ];

  if (!request.success || !key.success) return { ok: false, issues };

  return {
    ok: true,
    value: {
      request: request.data,
      ...(key.data === undefined ? {} : { idempotencyKey: key.data }),
    },
  };
}
