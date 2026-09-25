import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppointmentDispatchError } from '../src/application/errors.js';
import { RequestAppointment } from '../src/application/use-cases/request-appointment.js';
import type { AppointmentPublisher } from '../src/application/ports/appointment-publisher.js';
import type {
  AppointmentRecord,
  AppointmentRepository,
  CreatePendingResult,
} from '../src/application/ports/appointment-repository.js';

const request = { insuredId: '00123', scheduleId: 100, countryISO: 'PE' } as const;
const stored: AppointmentRecord = {
  ...request,
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  status: 'pending',
  createdAt: '2026-09-24T15:00:00.000Z',
};
const candidateId = 'new-generated-appointment-id';
const now = () => '2026-09-24T15:00:01.000Z';

function repositoryFor(
  result: CreatePendingResult,
  markPublished: AppointmentRepository['markPublished'] = async () => {},
): AppointmentRepository {
  return {
    async createPending() { return result; },
    markPublished,
    async listByInsuredId() { return []; },
  };
}

describe('RequestAppointment', () => {
  it('guarda pending, publica el mismo appointmentId y marca la publicación antes de aceptar', async () => {
    const calls: string[] = [];
    let created: AppointmentRecord | undefined;
    let key: string | undefined;
    const repository: AppointmentRepository = {
      async createPending(appointment, idempotencyKey) {
        calls.push('save');
        created = appointment;
        key = idempotencyKey;
        return { kind: 'created', appointment };
      },
      async markPublished(insuredId, appointmentId, publishedAt) {
        calls.push('mark');
        assert.equal(insuredId, '00123');
        assert.equal(appointmentId, candidateId);
        assert.equal(publishedAt, now());
      },
      async listByInsuredId() { return []; },
    };
    const publisher: AppointmentPublisher = {
      async publish(appointment) {
        calls.push('publish');
        assert.deepEqual(appointment, created);
      },
    };

    const result = await new RequestAppointment(
      repository, publisher, () => candidateId, now,
    ).execute({ request, idempotencyKey: 'request-001' });

    assert.deepEqual(calls, ['save', 'publish', 'mark']);
    assert.equal(key, 'request-001');
    assert.deepEqual(result, {
      kind: 'accepted',
      appointment: {
        ...request,
        appointmentId: candidateId,
        status: 'pending',
        createdAt: now(),
      },
    });
  });

  it('reconoce un reintento ya publicado sin volver a publicar', async () => {
    const publisher: AppointmentPublisher = {
      async publish() { assert.fail('SNS no debe invocarse'); },
    };
    const repository = repositoryFor(
      { kind: 'replayed', appointment: { ...stored, publishedAt: now() } },
      async () => { assert.fail('No debe remarcarse'); },
    );

    const result = await new RequestAppointment(
      repository, publisher, () => candidateId, now,
    ).execute({ request, idempotencyKey: 'request-001' });

    assert.equal(result.kind, 'replayed');
    assert.equal(result.appointment.appointmentId, stored.appointmentId);
    assert.equal('publishedAt' in result.appointment, false);
  });

  it('reintenta la publicación pendiente con el appointmentId almacenado', async () => {
    let publishedId: string | undefined;
    let markedId: string | undefined;
    const publisher: AppointmentPublisher = {
      async publish(appointment) { publishedId = appointment.appointmentId; },
    };
    const repository = repositoryFor(
      { kind: 'replayed', appointment: stored },
      async (_insuredId, appointmentId) => { markedId = appointmentId; },
    );

    const result = await new RequestAppointment(
      repository, publisher, () => candidateId, now,
    ).execute({ request, idempotencyKey: 'request-001' });

    assert.equal(publishedId, stored.appointmentId);
    assert.equal(markedId, stored.appointmentId);
    assert.equal(result.appointment.appointmentId, stored.appointmentId);
    assert.equal(result.kind, 'replayed');
  });

  it('no vuelve a publicar una cita que ya terminó', async () => {
    const publisher: AppointmentPublisher = {
      async publish() { assert.fail('SNS no debe invocarse'); },
    };
    const repository = repositoryFor(
      { kind: 'replayed', appointment: { ...stored, status: 'completed' } },
      async () => { assert.fail('No debe remarcarse'); },
    );

    const result = await new RequestAppointment(
      repository, publisher, () => candidateId, now,
    ).execute({ request, idempotencyKey: 'request-001' });

    assert.equal(result.kind, 'replayed');
    assert.equal(result.appointment.status, 'completed');
  });

  it('informa el fallo de SNS y deja la cita disponible para reintentar', async () => {
    const failure = new Error('SNS temporalmente no disponible');
    let marked = false;
    const publisher: AppointmentPublisher = {
      async publish() { throw failure; },
    };
    const repository = repositoryFor(
      { kind: 'created', appointment: stored },
      async () => { marked = true; },
    );

    await assert.rejects(
      new RequestAppointment(repository, publisher, () => candidateId, now)
        .execute({ request, idempotencyKey: 'request-001' }),
      (error: unknown) => error instanceof AppointmentDispatchError
        && error.appointmentId === stored.appointmentId
        && error.cause === failure,
    );
    assert.equal(marked, false);
  });

  it('informa el fallo de marcado después de publicar para que se reintente con la misma clave', async () => {
    const failure = new Error('DynamoDB temporalmente no disponible');
    let published = false;
    const publisher: AppointmentPublisher = {
      async publish() { published = true; },
    };
    const repository = repositoryFor(
      { kind: 'created', appointment: stored },
      async () => { throw failure; },
    );

    await assert.rejects(
      new RequestAppointment(repository, publisher, () => candidateId, now)
        .execute({ request, idempotencyKey: 'request-001' }),
      (error: unknown) => error instanceof AppointmentDispatchError
        && error.appointmentId === stored.appointmentId
        && error.cause === failure,
    );
    assert.equal(published, true);
  });
});
