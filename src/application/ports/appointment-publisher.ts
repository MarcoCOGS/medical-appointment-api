import type { PendingAppointment } from '../../domain/appointment.js';

export interface AppointmentPublisher {
  publish(appointment: PendingAppointment): Promise<void>;
}
