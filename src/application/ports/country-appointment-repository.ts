import type { PendingAppointment, RejectionReason } from '../../domain/appointment.js';

export type CountryRegistration =
  | { kind: 'registered' | 'already_registered' }
  | { kind: 'rejected'; reason: RejectionReason };

export interface CountryAppointmentRepository {
  register(appointment: PendingAppointment): Promise<CountryRegistration>;
}
