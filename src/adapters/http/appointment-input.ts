import type { AppointmentRequest, CountryISO } from '../../domain/appointment.js';

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

const REQUEST_FIELDS = new Set(['insuredId', 'scheduleId', 'countryISO']);
const INSURED_ID_PATTERN = /^[0-9]{5}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateInsuredId(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string' || !INSURED_ID_PATTERN.test(value)) {
    return {
      ok: false,
      issues: [{ field: 'insuredId', message: 'Debe ser un texto de exactamente cinco dígitos.' }],
    };
  }

  return { ok: true, value };
}

function validateScheduleId(value: unknown): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return {
      ok: false,
      issues: [{ field: 'scheduleId', message: 'Debe ser un entero positivo seguro.' }],
    };
  }

  return { ok: true, value };
}

function validateCountryISO(value: unknown): ValidationResult<CountryISO> {
  if (value !== 'PE' && value !== 'CL') {
    return {
      ok: false,
      issues: [{ field: 'countryISO', message: 'Debe ser PE o CL.' }],
    };
  }

  return { ok: true, value };
}

function validateIdempotencyKey(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    return {
      ok: false,
      issues: [{
        field: 'Idempotency-Key',
        message: 'Debe tener entre 1 y 128 caracteres ASCII visibles, sin espacios.',
      }],
    };
  }

  return { ok: true, value };
}

export function validateCreateAppointment(
  body: unknown,
  idempotencyKey?: unknown,
): ValidationResult<ValidatedCreateAppointment> {
  if (!isRecord(body)) {
    return {
      ok: false,
      issues: [{ field: 'body', message: 'Debe ser un objeto JSON.' }],
    };
  }

  const insuredId = validateInsuredId(body.insuredId);
  const scheduleId = validateScheduleId(body.scheduleId);
  const countryISO = validateCountryISO(body.countryISO);
  const key = validateIdempotencyKey(idempotencyKey);

  const issues: ValidationIssue[] = [
    ...Object.keys(body)
      .filter((field) => !REQUEST_FIELDS.has(field))
      .map((field) => ({ field, message: 'Campo no permitido.' })),
    ...(!insuredId.ok ? insuredId.issues : []),
    ...(!scheduleId.ok ? scheduleId.issues : []),
    ...(!countryISO.ok ? countryISO.issues : []),
    ...(!key.ok ? key.issues : []),
  ];

  if (!insuredId.ok || !scheduleId.ok || !countryISO.ok || !key.ok || issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      request: {
        insuredId: insuredId.value,
        scheduleId: scheduleId.value,
        countryISO: countryISO.value,
      },
      ...(key.value === undefined ? {} : { idempotencyKey: key.value }),
    },
  };
}
