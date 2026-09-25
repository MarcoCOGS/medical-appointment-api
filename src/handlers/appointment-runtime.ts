import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { ConfirmAppointment } from '../application/use-cases/confirm-appointment.js';
import { ListAppointments } from '../application/use-cases/list-appointments.js';
import { RequestAppointment } from '../application/use-cases/request-appointment.js';
import { DynamoAppointmentRepository } from '../adapters/dynamodb/appointment-repository.js';
import { createAppointmentHttpHandler } from '../adapters/http/appointment-handler.js';
import { createAppointmentEntrypoint } from '../adapters/lambda/appointment-entrypoint.js';
import { createAppointmentConfirmationHandler } from '../adapters/sqs/appointment-confirmation-handler.js';
import { SnsAppointmentPublisher } from '../adapters/sns/appointment-publisher.js';

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
let repository: DynamoAppointmentRepository | undefined;
let publisher: SnsAppointmentPublisher | undefined;
const now = () => new Date().toISOString();

function getRepository(): DynamoAppointmentRepository {
  const tableName = process.env.APPOINTMENTS_TABLE;
  if (!tableName) {
    throw new Error('Falta la variable APPOINTMENTS_TABLE.');
  }
  repository ??= new DynamoAppointmentRepository(tableName, documentClient);
  return repository;
}

function getPublisher(): SnsAppointmentPublisher {
  const topicArn = process.env.APPOINTMENT_REQUESTS_TOPIC_ARN;
  if (!topicArn) {
    throw new Error('Falta la variable APPOINTMENT_REQUESTS_TOPIC_ARN.');
  }
  publisher ??= new SnsAppointmentPublisher(topicArn, new SNSClient({}));
  return publisher;
}

const httpHandler = createAppointmentHttpHandler({
  create: (input) => new RequestAppointment(
    getRepository(),
    getPublisher(),
    randomUUID,
    now,
  ).execute(input),
  list: (insuredId) => new ListAppointments(getRepository()).execute(insuredId),
});

const confirmationHandler = createAppointmentConfirmationHandler({
  execute: (outcome) => new ConfirmAppointment(getRepository()).execute(outcome),
});

export const main = createAppointmentEntrypoint(httpHandler, confirmationHandler);
