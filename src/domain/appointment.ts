export type CountryISO = 'PE' | 'CL';

export type AppointmentStatus = 'pending' | 'completed' | 'rejected';

export type RejectionReason = 'SLOT_NOT_FOUND' | 'SLOT_UNAVAILABLE';

export interface AppointmentRequest {
  insuredId: string;
  scheduleId: number;
  countryISO: CountryISO;
}

export interface Appointment extends AppointmentRequest {
  appointmentId: string;
  status: AppointmentStatus;
  createdAt: string;
  rejectionReason?: RejectionReason;
}

export interface PendingAppointment extends AppointmentRequest {
  appointmentId: string;
  status: 'pending';
  createdAt: string;
}

export type CountryAppointmentOutcome = Omit<PendingAppointment, 'status'> & (
  | { status: 'completed' }
  | { status: 'rejected'; rejectionReason: RejectionReason }
);
