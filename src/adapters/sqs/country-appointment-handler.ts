import type { CountryISO } from '../../domain/appointment.js';
import type { ProcessCountryAppointment } from '../../application/use-cases/process-country-appointment.js';
import { parseAppointmentRequestMessage } from './appointment-request-message.js';

export interface CountrySqsEvent {
  Records: Array<{ messageId: string; body?: string }>;
}

export function createCountryAppointmentHandler(
  countryISO: CountryISO,
  process: Pick<ProcessCountryAppointment, 'execute'>,
  log: (entry: Record<string, unknown>) => void = (entry) => console.info(JSON.stringify(entry)),
): (event: CountrySqsEvent) => Promise<void> {
  return async (event) => {
    if (!Array.isArray(event?.Records) || event.Records.length === 0) {
      throw new Error('El evento SQS no contiene registros.');
    }

    for (const record of event.Records) {
      const appointment = parseAppointmentRequestMessage(record.body, countryISO);
      const outcome = await process.execute(appointment);
      log({
        event: 'appointment.country_decision',
        appointmentId: outcome.appointmentId,
        countryISO,
        status: outcome.status,
        ...(outcome.status === 'rejected'
          ? { rejectionReason: outcome.rejectionReason }
          : {}),
      });
    }
  };
}
