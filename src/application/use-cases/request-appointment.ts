import type { AppointmentSummary } from '../dto/appointment-result.js';
import { toAppointmentSummary } from '../dto/appointment-result.js';
import { AppointmentDispatchError } from '../errors.js';
import type { AppointmentPublisher } from '../ports/appointment-publisher.js';
import type { AppointmentRepository } from '../ports/appointment-repository.js';
import type { AppointmentRequest, PendingAppointment } from '../../domain/appointment.js';

export interface RequestAppointmentCommand {
  request: AppointmentRequest;
  idempotencyKey?: string;
}

export interface RequestAppointmentResult {
  kind: 'accepted' | 'replayed';
  appointment: AppointmentSummary;
}

export class RequestAppointment {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly publisher: AppointmentPublisher,
    private readonly newId: () => string,
    private readonly now: () => string,
  ) {}

  async execute(command: RequestAppointmentCommand): Promise<RequestAppointmentResult> {
    const candidate: PendingAppointment = {
      ...command.request,
      appointmentId: this.newId(),
      status: 'pending',
      createdAt: this.now(),
    };
    const result = await this.repository.createPending(candidate, command.idempotencyKey);
    const appointment = result.appointment;

    if (appointment.status === 'pending' && appointment.publishedAt === undefined) {
      const pending: PendingAppointment = {
        appointmentId: appointment.appointmentId,
        insuredId: appointment.insuredId,
        scheduleId: appointment.scheduleId,
        countryISO: appointment.countryISO,
        status: 'pending',
        createdAt: appointment.createdAt,
      };

      try {
        await this.publisher.publish(pending);
        await this.repository.markPublished(
          appointment.insuredId,
          appointment.appointmentId,
          this.now(),
        );
      } catch (cause) {
        throw new AppointmentDispatchError(appointment.appointmentId, cause);
      }
    }

    return {
      kind: result.kind === 'created' ? 'accepted' : 'replayed',
      appointment: toAppointmentSummary(appointment),
    };
  }
}
