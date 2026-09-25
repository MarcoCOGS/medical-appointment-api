import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ListAppointments } from '../src/application/use-cases/list-appointments.js';
import type { AppointmentRepository } from '../src/application/ports/appointment-repository.js';

const request = { insuredId: '00123', scheduleId: 100, countryISO: 'PE' } as const;

describe('ListAppointments', () => {
  it('lista las citas sin exponer el estado interno de publicación SNS', async () => {
    const repository: AppointmentRepository = {
      async createPending(appointment) { return { kind: 'created', appointment }; },
      async markPublished() {},
      async listByInsuredId(insuredId) {
        assert.equal(insuredId, '00123');
        return [{
          ...request,
          appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
          status: 'pending',
          createdAt: '2026-09-24T15:00:00.000Z',
          publishedAt: '2026-09-24T15:00:01.000Z',
        }];
      },
    };

    const result = await new ListAppointments(repository).execute('00123');
    assert.deepEqual(result, {
      insuredId: '00123',
      appointments: [{
        ...request,
        appointmentId: '89f6248e-dbd8-42e0-b9a8-fd69107f75a8',
        status: 'pending',
        createdAt: '2026-09-24T15:00:00.000Z',
      }],
    });
  });

  it('presenta igual los horarios inexistentes y ocupados sin revelar el motivo interno', async () => {
    const common = {
      ...request,
      status: 'rejected' as const,
      createdAt: '2026-09-24T15:00:00.000Z',
    };
    const repository: AppointmentRepository = {
      async createPending(appointment) { return { kind: 'created', appointment }; },
      async markPublished() {},
      async listByInsuredId() {
        return [
          { ...common, appointmentId: 'not-found', rejectionReason: 'SLOT_NOT_FOUND' },
          { ...common, appointmentId: 'occupied', rejectionReason: 'SLOT_UNAVAILABLE' },
        ];
      },
    };

    const result = await new ListAppointments(repository).execute('00123');
    assert.deepEqual(result.appointments, [
      {
        ...common,
        appointmentId: 'not-found',
        rejectionReason: 'SLOT_UNAVAILABLE',
        rejectionMessage: 'El horario solicitado no está disponible.',
      },
      {
        ...common,
        appointmentId: 'occupied',
        rejectionReason: 'SLOT_UNAVAILABLE',
        rejectionMessage: 'El horario solicitado no está disponible.',
      },
    ]);
  });
});
