import type { AppointmentSummary } from '../../application/dto/appointment-result.js';

export interface CreateAppointmentResponse extends AppointmentSummary {
  message: string;
}
