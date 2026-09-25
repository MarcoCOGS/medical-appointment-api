import type { CountryAppointmentOutcome } from '../../domain/appointment.js';

export interface AppointmentResultPublisher {
  publish(outcome: CountryAppointmentOutcome): Promise<void>;
}
