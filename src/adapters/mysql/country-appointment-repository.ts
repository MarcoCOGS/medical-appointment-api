import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  CountryAppointmentRepository,
  CountryRegistration,
} from '../../application/ports/country-appointment-repository.js';
import type { PendingAppointment } from '../../domain/appointment.js';

interface ExistingAppointmentRow extends RowDataPacket {
  insured_id: string;
  schedule_id: number | string;
}

interface OccupiedScheduleRow extends RowDataPacket {
  appointment_id: string;
}

const FIND_BY_ID = `
  SELECT insured_id, schedule_id
  FROM appointments
  WHERE appointment_id = ?
`;
const INSERT_IF_SLOT_EXISTS = `
  INSERT INTO appointments (appointment_id, insured_id, schedule_id)
  SELECT ?, ?, schedule_id
  FROM schedule_slots
  WHERE schedule_id = ?
`;
const FIND_BY_SCHEDULE = `
  SELECT appointment_id
  FROM appointments
  WHERE schedule_id = ?
`;

export class AppointmentIdentityConflictError extends Error {
  constructor() {
    super('El appointmentId ya existe con otro asegurado u horario.');
    this.name = 'AppointmentIdentityConflictError';
  }
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

export class MySqlCountryAppointmentRepository implements CountryAppointmentRepository {
  constructor(private readonly pool: Pool) {}

  private async findById(appointmentId: string): Promise<ExistingAppointmentRow | undefined> {
    const [rows] = await this.pool.execute<ExistingAppointmentRow[]>(FIND_BY_ID, [appointmentId]);
    return rows[0];
  }

  private existingResult(
    existing: ExistingAppointmentRow,
    appointment: PendingAppointment,
  ): CountryRegistration {
    if (existing.insured_id !== appointment.insuredId
      || String(existing.schedule_id) !== String(appointment.scheduleId)) {
      throw new AppointmentIdentityConflictError();
    }
    return { kind: 'already_registered' };
  }

  async register(appointment: PendingAppointment): Promise<CountryRegistration> {
    const existing = await this.findById(appointment.appointmentId);
    if (existing) return this.existingResult(existing, appointment);

    try {
      const [result] = await this.pool.execute<ResultSetHeader>(INSERT_IF_SLOT_EXISTS, [
        appointment.appointmentId,
        appointment.insuredId,
        appointment.scheduleId,
      ]);
      if (result.affectedRows === 1) return { kind: 'registered' };
      if (result.affectedRows === 0) return { kind: 'rejected', reason: 'SLOT_NOT_FOUND' };
      throw new Error('MySQL devolvió un número inesperado de citas insertadas.');
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      const insertedById = await this.findById(appointment.appointmentId);
      if (insertedById) return this.existingResult(insertedById, appointment);

      const [occupiedRows] = await this.pool.execute<OccupiedScheduleRow[]>(
        FIND_BY_SCHEDULE,
        [appointment.scheduleId],
      );
      if (occupiedRows.length > 0) {
        return { kind: 'rejected', reason: 'SLOT_UNAVAILABLE' };
      }

      throw error;
    }
  }
}
