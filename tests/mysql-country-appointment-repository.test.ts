import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'mysql2/promise';
import {
  AppointmentIdentityConflictError,
  MySqlCountryAppointmentRepository,
} from '../src/adapters/mysql/country-appointment-repository.js';
import type { PendingAppointment } from '../src/domain/appointment.js';

const appointment: PendingAppointment = {
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'pending',
  createdAt: '2026-09-24T15:00:00.000Z',
};

type Step = {
  sql: RegExp;
  values: unknown[];
  rows?: unknown;
  error?: unknown;
};

function scriptedPool(steps: Step[]): { pool: Pool; assertDone: () => void } {
  let index = 0;
  const pool = {
    async execute(sql: string, values: unknown[]) {
      const step = steps[index++];
      assert.ok(step, `Consulta inesperada: ${sql}`);
      assert.match(sql, step.sql);
      assert.deepEqual(values, step.values);
      if (step.error) throw step.error;
      return [step.rows, []];
    },
  } as unknown as Pool;
  return {
    pool,
    assertDone: () => assert.equal(index, steps.length, 'Faltaron consultas esperadas'),
  };
}

const byId = (rows: unknown[]): Step => ({
  sql: /SELECT insured_id, schedule_id\s+FROM appointments\s+WHERE appointment_id = \?/,
  values: [appointment.appointmentId],
  rows,
});
const insert = (rows: unknown): Step => ({
  sql: /INSERT INTO appointments .*SELECT \?, \?, schedule_id\s+FROM schedule_slots\s+WHERE schedule_id = \?/s,
  values: [appointment.appointmentId, appointment.insuredId, appointment.scheduleId],
  rows,
});
const duplicate = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });

describe('MySqlCountryAppointmentRepository', () => {
  it('inserta una cita nueva con valores parametrizados si el horario existe', async () => {
    const db = scriptedPool([byId([]), insert({ affectedRows: 1 })]);
    const result = await new MySqlCountryAppointmentRepository(db.pool).register(appointment);
    assert.deepEqual(result, { kind: 'registered' });
    db.assertDone();
  });

  it('rechaza un scheduleId que no existe sin registrar una cita', async () => {
    const db = scriptedPool([byId([]), insert({ affectedRows: 0 })]);
    const result = await new MySqlCountryAppointmentRepository(db.pool).register(appointment);
    assert.deepEqual(result, { kind: 'rejected', reason: 'SLOT_NOT_FOUND' });
    db.assertDone();
  });

  it('reconoce el mismo appointmentId y rechaza reutilizarlo con otros datos', async () => {
    const existing = { insured_id: '00123', schedule_id: '100' };
    const replay = scriptedPool([byId([existing])]);
    assert.deepEqual(
      await new MySqlCountryAppointmentRepository(replay.pool).register(appointment),
      { kind: 'already_registered' },
    );
    replay.assertDone();

    for (const changed of [
      { insured_id: '99999', schedule_id: 100 },
      { insured_id: '00123', schedule_id: 101 },
    ]) {
      const conflict = scriptedPool([byId([changed])]);
      await assert.rejects(
        new MySqlCountryAppointmentRepository(conflict.pool).register(appointment),
        AppointmentIdentityConflictError,
      );
      conflict.assertDone();
    }
  });

  it('clasifica un duplicado concurrente por appointmentId como reintento', async () => {
    const db = scriptedPool([
      byId([]),
      { ...insert(undefined), error: duplicate },
      byId([{ insured_id: '00123', schedule_id: 100 }]),
    ]);
    assert.deepEqual(
      await new MySqlCountryAppointmentRepository(db.pool).register(appointment),
      { kind: 'already_registered' },
    );
    db.assertDone();
  });

  it('clasifica un duplicado concurrente por scheduleId como horario ocupado', async () => {
    const db = scriptedPool([
      byId([]),
      { ...insert(undefined), error: duplicate },
      byId([]),
      {
        sql: /SELECT appointment_id\s+FROM appointments\s+WHERE schedule_id = \?/,
        values: [100],
        rows: [{ appointment_id: 'another-appointment-id' }],
      },
    ]);
    assert.deepEqual(
      await new MySqlCountryAppointmentRepository(db.pool).register(appointment),
      { kind: 'rejected', reason: 'SLOT_UNAVAILABLE' },
    );
    db.assertDone();
  });

  it('propaga errores MySQL que no representan un duplicado', async () => {
    const failure = Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
    const db = scriptedPool([byId([]), { ...insert(undefined), error: failure }]);
    await assert.rejects(
      new MySqlCountryAppointmentRepository(db.pool).register(appointment),
      (error: unknown) => error === failure,
    );
    db.assertDone();
  });
});
