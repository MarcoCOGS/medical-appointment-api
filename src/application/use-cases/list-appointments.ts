import type { ListAppointmentsResult } from '../dto/appointment-result.js';
import { toAppointmentSummary } from '../dto/appointment-result.js';
import type { AppointmentRepository } from '../ports/appointment-repository.js';

export class ListAppointments {
  constructor(private readonly repository: AppointmentRepository) {}

  async execute(insuredId: string): Promise<ListAppointmentsResult> {
    const records = await this.repository.listByInsuredId(insuredId);
    return {
      insuredId,
      appointments: records.map(toAppointmentSummary),
    };
  }
}
