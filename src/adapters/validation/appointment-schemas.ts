import { z } from 'zod';

export const insuredIdSchema = z.string().regex(/^[0-9]{5}$/);
export const scheduleIdSchema = z.int().positive();
export const countryIsoSchema = z.enum(['PE', 'CL']);

// El contrato publicado acepta UUID con esta forma, sin imponer una versión concreta.
export const appointmentIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

export const createdAtSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
);

export function firstIssueField(error: z.ZodError): string {
  return error.issues[0]?.path.join('.') || 'body';
}
