import type { CountryAppointmentOutcome } from '../../domain/appointment.js';

export type AppointmentConfirmationResult = 'updated' | 'replayed';

export interface AppointmentConfirmationRepository {
  applyOutcome(outcome: CountryAppointmentOutcome): Promise<AppointmentConfirmationResult>;
}
