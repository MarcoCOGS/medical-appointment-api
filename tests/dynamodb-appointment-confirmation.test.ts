import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  AppointmentConfirmationConflictError,
  DynamoAppointmentRepository,
} from '../src/adapters/dynamodb/appointment-repository.js';
import type { CountryAppointmentOutcome } from '../src/domain/appointment.js';

const completed: CountryAppointmentOutcome = {
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'completed',
  createdAt: '2026-09-24T15:00:00.000Z',
};
const rejected: CountryAppointmentOutcome = {
  ...completed,
  status: 'rejected',
  rejectionReason: 'SLOT_UNAVAILABLE',
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    PK: 'INSURED#00123',
    SK: 'APPOINTMENT#' + completed.appointmentId,
    entityType: 'APPOINTMENT',
    ...completed,
    ...overrides,
  };
}

function fakeClient(send: (command: unknown) => Promise<unknown>): DynamoDBDocumentClient {
  return { send } as unknown as DynamoDBDocumentClient;
}

function conditionalFailure(): Error {
  const error = new Error('Condition failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

function assertConflict(error: unknown, reason: string): boolean {
  return error instanceof AppointmentConfirmationConflictError && error.reason === reason;
}

describe('DynamoAppointmentRepository.applyOutcome', () => {
  for (const outcome of [completed, rejected]) {
    it(`cambia pending a ${outcome.status} con identidad y estado condicionados`, async () => {
      let observed: UpdateCommand | undefined;
      const client = fakeClient(async (command) => {
        assert.ok(command instanceof UpdateCommand);
        observed = command;
        return {};
      });
      const result = await new DynamoAppointmentRepository('test-table', client)
        .applyOutcome(outcome);
      assert.equal(result, 'updated');
      assert.ok(observed);
      assert.deepEqual(observed.input.Key, {
        PK: 'INSURED#00123',
        SK: 'APPOINTMENT#' + completed.appointmentId,
      });
      assert.match(observed.input.ConditionExpression ?? '', /#status = :pending/);
      for (const field of ['appointmentId', 'insuredId', 'scheduleId', 'countryISO', 'createdAt']) {
        assert.match(observed.input.ConditionExpression ?? '', new RegExp(`#${field} = :${field}`));
      }
      assert.equal(observed.input.ExpressionAttributeValues?.[':nextStatus'], outcome.status);
      if (outcome.status === 'rejected') {
        assert.equal(observed.input.ExpressionAttributeValues?.[':reason'], 'SLOT_UNAVAILABLE');
      } else {
        assert.match(observed.input.UpdateExpression ?? '', /REMOVE #rejectionReason/);
      }
    });
  }

  for (const outcome of [completed, rejected]) {
    it(`reconoce una entrega repetida de ${outcome.status} sin sobrescribirla`, async () => {
      const client = fakeClient(async (command) => {
        if (command instanceof UpdateCommand) throw conditionalFailure();
        assert.ok(command instanceof GetCommand);
        assert.equal(command.input.ConsistentRead, true);
        return { Item: item(outcome) };
      });
      const result = await new DynamoAppointmentRepository('test-table', client)
        .applyOutcome(outcome);
      assert.equal(result, 'replayed');
    });
  }

  it('rechaza un evento que no coincide con el horario almacenado', async () => {
    const client = fakeClient(async (command) => {
      if (command instanceof UpdateCommand) throw conditionalFailure();
      return { Item: item({ scheduleId: 101 }) };
    });
    await assert.rejects(
      new DynamoAppointmentRepository('test-table', client).applyOutcome(completed),
      (error: unknown) => assertConflict(error, 'IDENTITY_MISMATCH'),
    );
  });

  it('rechaza una decisión contraria a un estado terminal', async () => {
    const client = fakeClient(async (command) => {
      if (command instanceof UpdateCommand) throw conditionalFailure();
      return { Item: item(rejected) };
    });
    await assert.rejects(
      new DynamoAppointmentRepository('test-table', client).applyOutcome(completed),
      (error: unknown) => assertConflict(error, 'TERMINAL_CONFLICT'),
    );
  });

  it('no crea una cita inexistente al recibir una confirmación', async () => {
    const client = fakeClient(async (command) => {
      if (command instanceof UpdateCommand) throw conditionalFailure();
      return {};
    });
    await assert.rejects(
      new DynamoAppointmentRepository('test-table', client).applyOutcome(completed),
      (error: unknown) => assertConflict(error, 'NOT_FOUND'),
    );
  });

  it('propaga errores de DynamoDB ajenos a la condición', async () => {
    const failure = new Error('Throttling');
    const client = fakeClient(async () => { throw failure; });
    await assert.rejects(
      new DynamoAppointmentRepository('test-table', client).applyOutcome(completed),
      (error: unknown) => error === failure,
    );
  });
});
