import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppointmentResultPublisher } from '../src/application/ports/appointment-result-publisher.js';
import { ProcessCountryAppointment } from '../src/application/use-cases/process-country-appointment.js';
import type { CountryAppointmentOutcome, PendingAppointment } from '../src/domain/appointment.js';

const appointment: PendingAppointment = {
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'pending',
  createdAt: '2026-09-24T15:00:00.000Z',
};
const completed: CountryAppointmentOutcome = { ...appointment, status: 'completed' };

describe('ProcessCountryAppointment', () => {
  it('publica la decisión después de registrar la cita', async () => {
    const calls: string[] = [];
    const register = { async execute(input: PendingAppointment) {
      calls.push('register');
      assert.deepEqual(input, appointment);
      return completed;
    } };
    const publisher: AppointmentResultPublisher = { async publish(outcome) {
      calls.push('publish');
      assert.deepEqual(outcome, completed);
    } };

    const result = await new ProcessCountryAppointment(register, publisher).execute(appointment);
    assert.deepEqual(result, completed);
    assert.deepEqual(calls, ['register', 'publish']);
  });

  it('un fallo al publicar se propaga para que SQS reintente el mismo appointmentId', async () => {
    const failure = new Error('EventBridge temporalmente no disponible');
    const ids: string[] = [];
    const register = { async execute(input: PendingAppointment) {
      ids.push(input.appointmentId);
      return completed;
    } };
    let attempts = 0;
    const publisher: AppointmentResultPublisher = { async publish() {
      attempts += 1;
      if (attempts === 1) throw failure;
    } };
    const process = new ProcessCountryAppointment(register, publisher);

    await assert.rejects(process.execute(appointment), (error: unknown) => error === failure);
    assert.deepEqual(await process.execute(appointment), completed);
    assert.deepEqual(ids, [appointment.appointmentId, appointment.appointmentId]);
    assert.equal(attempts, 2);
  });

  it('no publica si falla el registro en MySQL', async () => {
    const failure = new Error('MySQL temporalmente no disponible');
    const register = { async execute(): Promise<CountryAppointmentOutcome> { throw failure; } };
    const publisher: AppointmentResultPublisher = {
      async publish() { assert.fail('No se debe publicar'); },
    };
    await assert.rejects(
      new ProcessCountryAppointment(register, publisher).execute(appointment),
      (error: unknown) => error === failure,
    );
  });
});
