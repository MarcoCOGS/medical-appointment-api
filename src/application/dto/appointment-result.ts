import type { Appointment, AppointmentStatus, CountryISO } from '../../domain/appointment.js';

export interface AppointmentSummary {
  appointmentId: string;
  insuredId: string;
  scheduleId: number;
  countryISO: CountryISO;
  status: AppointmentStatus;
  createdAt: string;
  rejectionReason?: 'SLOT_UNAVAILABLE';
  rejectionMessage?: string;
}

export interface ListAppointmentsResult {
  insuredId: string;
  appointments: AppointmentSummary[];
}

export function toAppointmentSummary(appointment: Appointment): AppointmentSummary {
  return {
    appointmentId: appointment.appointmentId,
    insuredId: appointment.insuredId,
    scheduleId: appointment.scheduleId,
    countryISO: appointment.countryISO,
    status: appointment.status,
    createdAt: appointment.createdAt,
    ...(appointment.rejectionReason === undefined
      ? {}
      : {
        rejectionReason: 'SLOT_UNAVAILABLE' as const,
        rejectionMessage: 'El horario solicitado no está disponible.',
      }),
  };
}
