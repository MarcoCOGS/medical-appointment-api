import assert from 'node:assert/strict';
import { AppointmentDispatchError, IdempotencyConflictError } from '../src/application/errors.js';
import { describe, it } from 'node:test';
import {
  createAppointmentHttpHandler,
  type AppointmentHttpActions,
  type HttpApiEvent,
} from '../src/handlers/appointment.js';

const request = { insuredId: '00123', scheduleId: 100, countryISO: 'PE' } as const;
const appointment = {
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  ...request,
  status: 'pending',
  createdAt: '2026-09-24T15:00:00.000Z',
} as const;

function post(body: string, extra: Partial<HttpApiEvent> = {}): HttpApiEvent {
  return { routeKey: 'POST /appointments', body, ...extra };
}

function get(insuredId: string): HttpApiEvent {
  return {
    routeKey: 'GET /appointments/{insuredId}',
    pathParameters: { insuredId },
  };
}

describe('handler HTTP de appointment', () => {
  it('rechaza JSON malformado con 400 antes de invocar el caso de uso', async () => {
    let calls = 0;
    const actions: AppointmentHttpActions = {
      async create() { calls += 1; return { kind: 'accepted', appointment }; },
      async list() { return { insuredId: '00123', appointments: [] }; },
    };

    const response = await createAppointmentHttpHandler(actions)(post('{'));
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.code, 'INVALID_JSON');
    assert.equal(calls, 0);
  });

  it('rechaza campos inválidos con 400 antes de invocar el caso de uso', async () => {
    let calls = 0;
    const actions: AppointmentHttpActions = {
      async create() { calls += 1; return { kind: 'accepted', appointment }; },
      async list() { return { insuredId: '00123', appointments: [] }; },
    };

    const response = await createAppointmentHttpHandler(actions)(
      post(JSON.stringify({ ...request, insuredId: 12345 })),
    );
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.details[0].field, 'insuredId');
    assert.equal(calls, 0);
  });

  it('delega POST válido y responde 202 con el mensaje acordado', async () => {
    let received: unknown;
    const actions: AppointmentHttpActions = {
      async create(input) {
        received = input;
        return { kind: 'accepted', appointment };
      },
      async list() { return { insuredId: '00123', appointments: [] }; },
    };

    const response = await createAppointmentHttpHandler(actions)(
      post(JSON.stringify(request), { headers: { 'idempotency-key': 'request-001' } }),
    );
    assert.equal(response.statusCode, 202);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(received, { request, idempotencyKey: 'request-001' });
    assert.deepEqual(JSON.parse(response.body), {
      ...appointment,
      message: 'El agendamiento está en proceso.',
    });
  });

  it('reconoce cabeceras con distinta capitalización y cuerpos base64', async () => {
    let received: unknown;
    const actions: AppointmentHttpActions = {
      async create(input) {
        received = input;
        return { kind: 'replayed', appointment };
      },
      async list() { return { insuredId: '00123', appointments: [] }; },
    };

    const response = await createAppointmentHttpHandler(actions)(
      post(Buffer.from(JSON.stringify(request)).toString('base64'), {
        isBase64Encoded: true,
        headers: { 'Idempotency-Key': 'request-001' },
      }),
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(received, { request, idempotencyKey: 'request-001' });
    assert.equal(JSON.parse(response.body).message, 'Se recuperó una solicitud existente.');
  });

  it('responde 409 si la clave pertenece a otra solicitud', async () => {
    const actions: AppointmentHttpActions = {
      async create() { throw new IdempotencyConflictError(); },
    };
    const response = await createAppointmentHttpHandler(actions)(
      post(JSON.stringify(request), { headers: { 'idempotency-key': 'request-001' } }),
    );
    assert.equal(response.statusCode, 409);
    assert.deepEqual(JSON.parse(response.body).error, {
      code: 'REQUEST_CONFLICT',
      message: 'No se pudo procesar la solicitud por un conflicto.',
    });
  });

  it('responde 503 con el appointmentId si se guardó pero falló el envío', async () => {
    const actions: AppointmentHttpActions = {
      async create() {
        throw new AppointmentDispatchError(appointment.appointmentId, new Error('SNS'));
      },
    };
    const response = await createAppointmentHttpHandler(actions)(post(JSON.stringify(request)));
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body).error, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'No fue posible confirmar el procesamiento. Consulta el estado antes de reintentar.',
      appointmentId: appointment.appointmentId,
    });
  });

  it('delega GET válido conservando los ceros iniciales', async () => {
    let received: string | undefined;
    const actions: AppointmentHttpActions = {
      async create() { return { kind: 'accepted', appointment }; },
      async list(insuredId) {
        received = insuredId;
        return { insuredId, appointments: [appointment] };
      },
    };

    const response = await createAppointmentHttpHandler(actions)(get('00123'));
    assert.equal(response.statusCode, 200);
    assert.equal(received, '00123');
    assert.deepEqual(JSON.parse(response.body), {
      insuredId: '00123',
      appointments: [appointment],
    });
  });

  it('rechaza insuredId inválido en GET con 400', async () => {
    const response = await createAppointmentHttpHandler()(get('1234'));
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.details[0].field, 'insuredId');
  });

  it('responde 501 si no se inyecta la acción create', async () => {
    const response = await createAppointmentHttpHandler()(post(JSON.stringify(request)));
    assert.equal(response.statusCode, 501);
    assert.equal(JSON.parse(response.body).error.code, 'NOT_IMPLEMENTED');
  });

  it('responde 404 si llega una ruta desconocida', async () => {
    const response = await createAppointmentHttpHandler()({ routeKey: 'DELETE /appointments' });
    assert.equal(response.statusCode, 404);
  });
});
