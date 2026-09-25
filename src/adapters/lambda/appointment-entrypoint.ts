import type { HttpApiEvent, HttpApiResponse } from '../http/appointment-handler.js';
import type { ConfirmationSqsEvent } from '../sqs/appointment-confirmation-handler.js';

export function createAppointmentEntrypoint(
  http: (event: HttpApiEvent) => Promise<HttpApiResponse>,
  confirmation: (event: ConfirmationSqsEvent) => Promise<void>,
): (event: HttpApiEvent | ConfirmationSqsEvent) => Promise<HttpApiResponse | void> {
  return (event) => {
    if (event && typeof event === 'object' && 'Records' in event) {
      return confirmation(event as ConfirmationSqsEvent);
    }
    return http(event as HttpApiEvent);
  };
}
