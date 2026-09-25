import type { CountryAppointmentOutcome } from '../../domain/appointment.js';
import type {
  AppointmentConfirmationRepository,
  AppointmentConfirmationResult,
} from '../ports/appointment-confirmation-repository.js';

export class ConfirmAppointment {
  constructor(private readonly repository: AppointmentConfirmationRepository) {}

  execute(outcome: CountryAppointmentOutcome): Promise<AppointmentConfirmationResult> {
    return this.repository.applyOutcome(outcome);
  }
}
