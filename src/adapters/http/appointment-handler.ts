import type {
  AppointmentSummary,
  ListAppointmentsResult,
} from '../../application/dto/appointment-result.js';
import type { CreateAppointmentResponse } from './appointment-response.js';
import { AppointmentDispatchError, IdempotencyConflictError } from '../../application/errors.js';
import {
  validateCreateAppointment,
  validateInsuredId,
  type ValidatedCreateAppointment,
  type ValidationIssue,
} from './appointment-input.js';

export interface HttpApiEvent {
  routeKey: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string | undefined>;
}

export interface HttpApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface AppointmentHttpActions {
  create?(input: ValidatedCreateAppointment): Promise<{
    kind: 'accepted' | 'replayed';
    appointment: AppointmentSummary;
  }>;
  list?(insuredId: string): Promise<ListAppointmentsResult>;
}

function json(statusCode: number, body: unknown): HttpApiResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function validationError(issues: ValidationIssue[]): HttpApiResponse {
  return json(400, {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'La solicitud contiene datos inválidos.',
      details: issues,
    },
  });
}

function headerValue(event: HttpApiEvent, name: string): string | undefined {
  const header = Object.entries(event.headers ?? {})
    .find(([key]) => key.toLowerCase() === name.toLowerCase());

  return header?.[1];
}

function parseBody(event: HttpApiEvent): unknown {
  if (typeof event.body !== 'string' || event.body.length === 0) {
    throw new SyntaxError('JSON body is missing');
  }

  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  return JSON.parse(text) as unknown;
}

export function createAppointmentHttpHandler(actions?: AppointmentHttpActions) {
  return async (event: HttpApiEvent): Promise<HttpApiResponse> => {
    if (event.routeKey === 'POST /appointments') {
      let body: unknown;
      try {
        body = parseBody(event);
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throw error;
        }
        return json(400, {
          error: {
            code: 'INVALID_JSON',
            message: 'El cuerpo debe contener un objeto JSON válido.',
          },
        });
      }

      const parsed = validateCreateAppointment(
        body,
        headerValue(event, 'Idempotency-Key'),
      );
      if (!parsed.ok) {
        return validationError(parsed.issues);
      }

      if (!actions?.create) {
        return json(501, {
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'El procesamiento de citas aún no está conectado.',
          },
        });
      }

      let outcome: Awaited<ReturnType<NonNullable<AppointmentHttpActions['create']>>>;
      try {
        outcome = await actions.create(parsed.value);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return json(409, {
            error: {
              code: 'REQUEST_CONFLICT',
              message: 'No se pudo procesar la solicitud por un conflicto.',
            },
          });
        }
        if (error instanceof AppointmentDispatchError) {
          return json(503, {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'No fue posible confirmar el procesamiento. Consulta el estado antes de reintentar.',
              appointmentId: error.appointmentId,
            },
          });
        }
        throw error;
      }

      const response: CreateAppointmentResponse = {
        ...outcome.appointment,
        message: outcome.kind === 'accepted'
          ? 'El agendamiento está en proceso.'
          : 'Se recuperó una solicitud existente.',
      };

      return json(outcome.kind === 'accepted' ? 202 : 200, response);
    }

    if (event.routeKey === 'GET /appointments/{insuredId}') {
      const parsed = validateInsuredId(event.pathParameters?.insuredId);
      if (!parsed.ok) {
        return validationError(parsed.issues);
      }

      if (!actions?.list) {
        return json(501, {
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'La consulta de citas aún no está conectada.',
          },
        });
      }

      return json(200, await actions.list(parsed.value));
    }

    return json(404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Ruta no encontrada.',
      },
    });
  };
}

