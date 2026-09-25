import type { ConfirmAppointment } from '../../application/use-cases/confirm-appointment.js';
import { parseAppointmentConfirmationMessage } from './appointment-confirmation-message.js';

export interface ConfirmationSqsEvent {
  Records: Array<{ messageId: string; body?: string }>;
}

export function createAppointmentConfirmationHandler(
  confirm: Pick<ConfirmAppointment, 'execute'>,
  log: (entry: Record<string, unknown>) => void = (entry) => console.info(JSON.stringify(entry)),
): (event: ConfirmationSqsEvent) => Promise<void> {
  return async (event) => {
    if (!Array.isArray(event?.Records) || event.Records.length === 0) {
      throw new Error('El evento SQS de confirmación no contiene registros.');
    }

    for (const record of event.Records) {
      const outcome = parseAppointmentConfirmationMessage(record.body);
      const result = await confirm.execute(outcome);
      log({
        event: 'appointment.confirmed',
        appointmentId: outcome.appointmentId,
        countryISO: outcome.countryISO,
        status: outcome.status,
        result,
      });
    }
  };
}
