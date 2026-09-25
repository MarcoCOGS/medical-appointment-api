import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CountryAppointmentRepository } from '../src/application/ports/country-appointment-repository.js';
import {
  CountryMismatchError,
  RegisterCountryAppointment,
} from '../src/application/use-cases/register-country-appointment.js';
import type { PendingAppointment } from '../src/domain/appointment.js';

const appointment: PendingAppointment = {
  appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
  insuredId: '00123',
  scheduleId: 100,
  countryISO: 'PE',
  status: 'pending',
  createdAt: '2026-09-24T15:00:00.000Z',
};

describe('RegisterCountryAppointment', () => {
  it('pasa la identidad a la base del país y confirma una cita nueva', async () => {
    const repository: CountryAppointmentRepository = {
      async register(input) {
        assert.deepEqual(input, appointment);
        return { kind: 'registered' };
      },
    };
    const result = await new RegisterCountryAppointment('PE', repository).execute(appointment);
    assert.deepEqual(result, { ...appointment, status: 'completed' });
  });

  it('un reintento ya registrado produce la misma conformidad', async () => {
    const repository: CountryAppointmentRepository = {
      async register() { return { kind: 'already_registered' }; },
    };
    const result = await new RegisterCountryAppointment('PE', repository).execute(appointment);
    assert.deepEqual(result, { ...appointment, status: 'completed' });
  });

  it('devuelve rechazo de un horario ocupado para el futuro evento de confirmación', async () => {
    const repository: CountryAppointmentRepository = {
      async register() { return { kind: 'rejected', reason: 'SLOT_UNAVAILABLE' }; },
    };
    const result = await new RegisterCountryAppointment('PE', repository).execute(appointment);
    assert.deepEqual(result, {
      ...appointment,
      status: 'rejected',
      rejectionReason: 'SLOT_UNAVAILABLE',
    });
  });

  it('no llama la base de PE para una solicitud de CL', async () => {
    const repository: CountryAppointmentRepository = {
      async register() { assert.fail('La base no debe invocarse'); },
    };
    await assert.rejects(
      new RegisterCountryAppointment('PE', repository).execute({ ...appointment, countryISO: 'CL' }),
      CountryMismatchError,
    );
  });
});
