import { createHash } from 'node:crypto';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { IdempotencyConflictError } from '../../application/errors.js';
import type {
  AppointmentConfirmationRepository,
  AppointmentConfirmationResult,
} from '../../application/ports/appointment-confirmation-repository.js';
import type { CountryAppointmentOutcome } from '../../domain/appointment.js';
import type {
  AppointmentRecord,
  AppointmentRepository,
  CreatePendingResult,
  PendingAppointment,
} from '../../application/ports/appointment-repository.js';

const APPOINTMENT_PREFIX = 'APPOINTMENT#';
const IDEMPOTENCY_SK = 'REQUEST';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function appointmentKey(insuredId: string, appointmentId: string) {
  return {
    PK: 'INSURED#' + insuredId,
    SK: APPOINTMENT_PREFIX + appointmentId,
  };
}

function appointmentItem(appointment: PendingAppointment) {
  return {
    ...appointmentKey(appointment.insuredId, appointment.appointmentId),
    entityType: 'APPOINTMENT',
    ...appointment,
  };
}

function stringField(item: Record<string, unknown>, field: string): string {
  const value = item[field];
  if (typeof value !== 'string') {
    throw new Error('Registro DynamoDB inválido: falta ' + field + '.');
  }
  return value;
}

function parseAppointment(item: unknown): AppointmentRecord {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw new Error('Registro DynamoDB inválido.');
  }
  const record = item as Record<string, unknown>;
  if (record.entityType !== 'APPOINTMENT') {
    throw new Error('Registro DynamoDB inesperado.');
  }
  const scheduleId = record.scheduleId;
  const countryISO = record.countryISO;
  const status = record.status;
  const rejectionReason = record.rejectionReason;
  const publishedAt = record.publishedAt;

  if (typeof scheduleId !== 'number' || !Number.isSafeInteger(scheduleId) || scheduleId <= 0) {
    throw new Error('Registro DynamoDB inválido: scheduleId.');
  }
  if (countryISO !== 'PE' && countryISO !== 'CL') {
    throw new Error('Registro DynamoDB inválido: countryISO.');
  }
  if (status !== 'pending' && status !== 'completed' && status !== 'rejected') {
    throw new Error('Registro DynamoDB inválido: status.');
  }
  if (
    rejectionReason !== undefined
    && rejectionReason !== 'SLOT_NOT_FOUND'
    && rejectionReason !== 'SLOT_UNAVAILABLE'
  ) {
    throw new Error('Registro DynamoDB inválido: rejectionReason.');
  }
  if (publishedAt !== undefined && typeof publishedAt !== 'string') {
    throw new Error('Registro DynamoDB inválido: publishedAt.');
  }

  return {
    appointmentId: stringField(record, 'appointmentId'),
    insuredId: stringField(record, 'insuredId'),
    scheduleId,
    countryISO,
    status,
    createdAt: stringField(record, 'createdAt'),
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

function isTransactionCanceled(error: unknown): boolean {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export type AppointmentConfirmationConflictReason =
  | 'NOT_FOUND'
  | 'IDENTITY_MISMATCH'
  | 'TERMINAL_CONFLICT';

export class AppointmentConfirmationConflictError extends Error {
  constructor(readonly reason: AppointmentConfirmationConflictReason) {
    super(`La confirmación no coincide con la solicitud guardada: ${reason}.`);
    this.name = 'AppointmentConfirmationConflictError';
  }
}

function sameAppointmentIdentity(
  stored: AppointmentRecord,
  outcome: CountryAppointmentOutcome,
): boolean {
  return stored.appointmentId === outcome.appointmentId
    && stored.insuredId === outcome.insuredId
    && stored.scheduleId === outcome.scheduleId
    && stored.countryISO === outcome.countryISO
    && stored.createdAt === outcome.createdAt;
}

export class DynamoAppointmentRepository
  implements AppointmentRepository, AppointmentConfirmationRepository {
  constructor(
    private readonly tableName: string,
    private readonly client: DynamoDBDocumentClient,
  ) {}

  async createPending(
    appointment: PendingAppointment,
    idempotencyKey?: string,
  ): Promise<CreatePendingResult> {
    const item = appointmentItem(appointment);

    if (idempotencyKey === undefined) {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }));
      return { kind: 'created', appointment };
    }

    const idempotencyPK = 'IDEMPOTENCY#' + digest(idempotencyKey);
    const fingerprint = digest(JSON.stringify([
      appointment.insuredId,
      appointment.scheduleId,
      appointment.countryISO,
    ]));

    try {
      await this.client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: item,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                PK: idempotencyPK,
                SK: IDEMPOTENCY_SK,
                entityType: 'IDEMPOTENCY',
                fingerprint,
                appointmentId: appointment.appointmentId,
                insuredId: appointment.insuredId,
                createdAt: appointment.createdAt,
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
        ],
      }));
      return { kind: 'created', appointment };
    } catch (error) {
      if (!isTransactionCanceled(error)) {
        throw error;
      }

      const mapping = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: idempotencyPK, SK: IDEMPOTENCY_SK },
        ConsistentRead: true,
      }));
      if (!mapping.Item) {
        throw error;
      }
      if (mapping.Item.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError();
      }

      const insuredId = stringField(mapping.Item, 'insuredId');
      const appointmentId = stringField(mapping.Item, 'appointmentId');
      const stored = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: appointmentKey(insuredId, appointmentId),
        ConsistentRead: true,
      }));
      if (!stored.Item) {
        throw new Error('La clave de idempotencia apunta a una cita inexistente.');
      }
      return { kind: 'replayed', appointment: parseAppointment(stored.Item) };
    }
  }

  async markPublished(
    insuredId: string,
    appointmentId: string,
    publishedAt: string,
  ): Promise<void> {
    await this.client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: appointmentKey(insuredId, appointmentId),
      UpdateExpression: 'SET #publishedAt = if_not_exists(#publishedAt, :publishedAt)',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #entityType = :entityType',
      ExpressionAttributeNames: {
        '#publishedAt': 'publishedAt',
        '#entityType': 'entityType',
      },
      ExpressionAttributeValues: {
        ':publishedAt': publishedAt,
        ':entityType': 'APPOINTMENT',
      },
    }));
  }

  async applyOutcome(outcome: CountryAppointmentOutcome): Promise<AppointmentConfirmationResult> {
    const names = {
      '#entityType': 'entityType',
      '#status': 'status',
      '#appointmentId': 'appointmentId',
      '#insuredId': 'insuredId',
      '#scheduleId': 'scheduleId',
      '#countryISO': 'countryISO',
      '#createdAt': 'createdAt',
      '#rejectionReason': 'rejectionReason',
    };
    const values = {
      ':entityType': 'APPOINTMENT',
      ':pending': 'pending',
      ':nextStatus': outcome.status,
      ':appointmentId': outcome.appointmentId,
      ':insuredId': outcome.insuredId,
      ':scheduleId': outcome.scheduleId,
      ':countryISO': outcome.countryISO,
      ':createdAt': outcome.createdAt,
      ...(outcome.status === 'rejected' ? { ':reason': outcome.rejectionReason } : {}),
    };

    try {
      await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: appointmentKey(outcome.insuredId, outcome.appointmentId),
        UpdateExpression: outcome.status === 'rejected'
          ? 'SET #status = :nextStatus, #rejectionReason = :reason'
          : 'SET #status = :nextStatus REMOVE #rejectionReason',
        ConditionExpression: [
          'attribute_exists(PK)',
          'attribute_exists(SK)',
          '#entityType = :entityType',
          '#status = :pending',
          '#appointmentId = :appointmentId',
          '#insuredId = :insuredId',
          '#scheduleId = :scheduleId',
          '#countryISO = :countryISO',
          '#createdAt = :createdAt',
        ].join(' AND '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return 'updated';
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;

      const current = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: appointmentKey(outcome.insuredId, outcome.appointmentId),
        ConsistentRead: true,
      }));
      if (!current.Item) throw new AppointmentConfirmationConflictError('NOT_FOUND');

      const stored = parseAppointment(current.Item);
      if (!sameAppointmentIdentity(stored, outcome)) {
        throw new AppointmentConfirmationConflictError('IDENTITY_MISMATCH');
      }
      if (outcome.status === 'completed'
        && stored.status === 'completed'
        && stored.rejectionReason === undefined) return 'replayed';
      if (outcome.status === 'rejected'
        && stored.status === 'rejected'
        && stored.rejectionReason === outcome.rejectionReason) return 'replayed';
      throw new AppointmentConfirmationConflictError('TERMINAL_CONFLICT');
    }
  }

  async listByInsuredId(insuredId: string): Promise<AppointmentRecord[]> {
    const appointments: AppointmentRecord[] = [];
    let lastKey: QueryCommandInput['ExclusiveStartKey'];

    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
        ExpressionAttributeValues: {
          ':pk': 'INSURED#' + insuredId,
          ':prefix': APPOINTMENT_PREFIX,
        },
        ConsistentRead: true,
        ...(lastKey === undefined ? {} : { ExclusiveStartKey: lastKey }),
      }));
      appointments.push(...(page.Items ?? []).map(parseAppointment));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey !== undefined);

    return appointments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
