import { readFileSync } from 'node:fs';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { createPool } from 'mysql2/promise';
import { EventBridgeAppointmentResultPublisher } from '../adapters/eventbridge/appointment-result-publisher.js';
import { MySqlCountryAppointmentRepository } from '../adapters/mysql/country-appointment-repository.js';
import {
  createCountryAppointmentHandler,
  type CountrySqsEvent,
} from '../adapters/sqs/country-appointment-handler.js';
import { RegisterCountryAppointment } from '../application/use-cases/register-country-appointment.js';
import { ProcessCountryAppointment } from '../application/use-cases/process-country-appointment.js';
import type { CountryISO } from '../domain/appointment.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name}.`);
  return value;
}

export function createCountryAppointmentRuntime(
  countryISO: CountryISO,
): (event: CountrySqsEvent) => Promise<void> {
  let processEvent: ((event: CountrySqsEvent) => Promise<void>) | undefined;

  return async (event) => {
    if (!processEvent) {
      const busArn = requiredEnvironment('APPOINTMENT_EVENTS_BUS_ARN');
      const pool = createPool({
        host: requiredEnvironment('MYSQL_HOST'),
        port: 3306,
        user: requiredEnvironment('MYSQL_USER'),
        password: requiredEnvironment('MYSQL_PASSWORD'),
        database: countryISO === 'PE' ? 'appointment_pe' : 'appointment_cl',
        ssl: {
          ca: readFileSync(requiredEnvironment('MYSQL_CA_PATH'), 'utf8'),
          rejectUnauthorized: true,
          verifyIdentity: true,
        },
        waitForConnections: true,
        connectionLimit: 2,
        timezone: 'Z',
      });
      const repository = new MySqlCountryAppointmentRepository(pool);
      const register = new RegisterCountryAppointment(countryISO, repository);
      const publisher = new EventBridgeAppointmentResultPublisher(
        busArn,
        new EventBridgeClient({}),
      );
      const process = new ProcessCountryAppointment(register, publisher);
      processEvent = createCountryAppointmentHandler(countryISO, process);
    }

    await processEvent(event);
  };
}
