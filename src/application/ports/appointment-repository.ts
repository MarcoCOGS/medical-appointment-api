import type { Appointment, PendingAppointment } from '../../domain/appointment.js';

export type { PendingAppointment } from '../../domain/appointment.js';

export interface AppointmentRecord extends Appointment {
  publishedAt?: string;
}

export interface CreatePendingResult {
  kind: 'created' | 'replayed';
  appointment: AppointmentRecord;
}

export interface AppointmentRepository {
  createPending(
    appointment: PendingAppointment,
    idempotencyKey?: string,
  ): Promise<CreatePendingResult>;
  markPublished(insuredId: string, appointmentId: string, publishedAt: string): Promise<void>;
  listByInsuredId(insuredId: string): Promise<AppointmentRecord[]>;
}
