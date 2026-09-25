import type { CountryAppointmentOutcome, PendingAppointment } from '../../domain/appointment.js';
import type { AppointmentResultPublisher } from '../ports/appointment-result-publisher.js';
import type { RegisterCountryAppointment } from './register-country-appointment.js';

export class ProcessCountryAppointment {
  constructor(
    private readonly register: Pick<RegisterCountryAppointment, 'execute'>,
    private readonly publisher: AppointmentResultPublisher,
  ) {}

  async execute(appointment: PendingAppointment): Promise<CountryAppointmentOutcome> {
    const outcome = await this.register.execute(appointment);
    await this.publisher.publish(outcome);
    return outcome;
  }
}
