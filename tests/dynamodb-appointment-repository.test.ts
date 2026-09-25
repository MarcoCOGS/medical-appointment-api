import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { IdempotencyConflictError } from '../src/application/errors.js';
import { DynamoAppointmentRepository } from '../src/adapters/dynamodb/appointment-repository.js';
import type { PendingAppointment } from '../src/application/ports/appointment-repository.js';

const appointment: PendingAppointment = {
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'pending',
  createdAt: '2026-09-24T15:00:00.000Z',
};

function fakeClient(send: (command: unknown) => Promise<unknown>): DynamoDBDocumentClient {
  return { send } as unknown as DynamoDBDocumentClient;
}

function appointmentItem(overrides: Record<string, unknown> = {}) {
  return {
    PK: 'INSURED#00123',
    SK: 'APPOINTMENT#' + appointment.appointmentId,
    entityType: 'APPOINTMENT',
    ...appointment,
    ...overrides,
  };
}

describe('DynamoAppointmentRepository', () => {
  it('crea sin clave con Put condicional', async () => {
    let observed: unknown;
    const client = fakeClient(async (command) => {
      observed = command;
      return {};
    });
    const result = await new DynamoAppointmentRepository('test-table', client)
      .createPending(appointment);

    assert.equal(result.kind, 'created');
    assert.ok(observed instanceof PutCommand);
    assert.equal(observed.input.TableName, 'test-table');
    assert.equal(observed.input.Item?.PK, 'INSURED#00123');
    assert.equal(observed.input.Item?.SK, 'APPOINTMENT#' + appointment.appointmentId);
    assert.match(observed.input.ConditionExpression ?? '', /attribute_not_exists/);
  });

  it('guarda cita y clave hasheada en una transacción', async () => {
    let observed: unknown;
    const client = fakeClient(async (command) => {
      observed = command;
      return {};
    });
    await new DynamoAppointmentRepository('test-table', client)
      .createPending(appointment, 'request-001');

    assert.ok(observed instanceof TransactWriteCommand);
    const entries = observed.input.TransactItems ?? [];
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.Put?.Item?.PK, 'INSURED#00123');
    assert.equal(entries[1]?.Put?.Item?.SK, 'REQUEST');
    const keyHash = createHash('sha256').update('request-001').digest('hex');
    assert.equal(entries[1]?.Put?.Item?.PK, 'IDEMPOTENCY#' + keyHash);
    assert.ok(!JSON.stringify(entries).includes('request-001'));
  });

  it('recupera la misma cita ante un reintento de la clave', async () => {
    let mapping: Record<string, unknown> | undefined;
    let original: Record<string, unknown> | undefined;
    const client = fakeClient(async (command) => {
      if (command instanceof TransactWriteCommand) {
        mapping = command.input.TransactItems?.[1]?.Put?.Item;
        original = command.input.TransactItems?.[0]?.Put?.Item;
        const error = new Error('Condición no cumplida');
        error.name = 'TransactionCanceledException';
        throw error;
      }
      assert.ok(command instanceof GetCommand);
      if (command.input.Key?.SK === 'REQUEST') {
        assert.equal(command.input.ConsistentRead, true);
        return { Item: mapping };
      }
      return { Item: { ...original, status: 'completed' } };
    });

    const result = await new DynamoAppointmentRepository('test-table', client)
      .createPending(appointment, 'request-001');
    assert.equal(result.kind, 'replayed');
    assert.equal(result.appointment.appointmentId, appointment.appointmentId);
    assert.equal(result.appointment.status, 'completed');
  });

  it('rechaza la reutilización de la clave con otro cuerpo', async () => {
    const client = fakeClient(async (command) => {
      if (command instanceof TransactWriteCommand) {
        const error = new Error('Condición no cumplida');
        error.name = 'TransactionCanceledException';
        throw error;
      }
      assert.ok(command instanceof GetCommand);
      return { Item: { fingerprint: 'otra-solicitud' } };
    });

    await assert.rejects(
      new DynamoAppointmentRepository('test-table', client)
        .createPending(appointment, 'request-001'),
      IdempotencyConflictError,
    );
  });

  it('marca publishedAt sin sobrescribir la primera publicación ni crear registros nuevos', async () => {
    let observed: unknown;
    const client = fakeClient(async (command) => {
      observed = command;
      return {};
    });

    await new DynamoAppointmentRepository('test-table', client)
      .markPublished('00123', appointment.appointmentId, '2026-09-24T15:00:01.000Z');

    assert.ok(observed instanceof UpdateCommand);
    assert.deepEqual(observed.input.Key, {
      PK: 'INSURED#00123',
      SK: 'APPOINTMENT#' + appointment.appointmentId,
    });
    assert.match(observed.input.UpdateExpression ?? '', /if_not_exists/);
    assert.match(observed.input.ConditionExpression ?? '', /attribute_exists/);
    assert.equal(observed.input.ExpressionAttributeValues?.[':publishedAt'], '2026-09-24T15:00:01.000Z');
  });

  it('consulta todas las páginas por insuredId con Query consistente', async () => {
    const queries: QueryCommand[] = [];
    const client = fakeClient(async (command) => {
      assert.ok(command instanceof QueryCommand);
      queries.push(command);
      if (queries.length === 1) {
        return {
          Items: [appointmentItem({ createdAt: '2026-09-24T15:00:00.000Z' })],
          LastEvaluatedKey: { PK: 'INSURED#00123', SK: 'APPOINTMENT#cursor' },
        };
      }
      return {
        Items: [appointmentItem({
          appointmentId: 'second',
          SK: 'APPOINTMENT#second',
          createdAt: '2026-09-24T16:00:00.000Z',
        })],
      };
    });

    const result = await new DynamoAppointmentRepository('test-table', client)
      .listByInsuredId('00123');
    assert.equal(queries.length, 2);
    assert.equal(queries[0]?.input.ExpressionAttributeValues?.[':pk'], 'INSURED#00123');
    assert.equal(queries[0]?.input.ConsistentRead, true);
    assert.deepEqual(queries[1]?.input.ExclusiveStartKey, {
      PK: 'INSURED#00123',
      SK: 'APPOINTMENT#cursor',
    });
    assert.deepEqual(result.map((item) => item.appointmentId), [
      'second',
      appointment.appointmentId,
    ]);
  });
});
