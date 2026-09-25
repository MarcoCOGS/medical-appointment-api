import type {
  CountryAppointmentOutcome,
  CountryISO,
  PendingAppointment,
} from '../../domain/appointment.js';
import type { CountryAppointmentRepository } from '../ports/country-appointment-repository.js';

export type { CountryAppointmentOutcome } from '../../domain/appointment.js';

export class CountryMismatchError extends Error {
  constructor() {
    super('La solicitud no corresponde al país de este procesador.');
    this.name = 'CountryMismatchError';
  }
}

export class RegisterCountryAppointment {
  constructor(
    private readonly countryISO: CountryISO,
    private readonly repository: CountryAppointmentRepository,
  ) {}

  async execute(appointment: PendingAppointment): Promise<CountryAppointmentOutcome> {
    if (appointment.countryISO !== this.countryISO) {
      throw new CountryMismatchError();
    }

    const result = await this.repository.register(appointment);
    if (result.kind === 'rejected') {
      return { ...appointment, status: 'rejected', rejectionReason: result.reason };
    }

    return { ...appointment, status: 'completed' };
  }
}
