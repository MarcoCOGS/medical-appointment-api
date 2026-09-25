import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateCreateAppointment, validateInsuredId } from '../src/adapters/http/appointment-input.js';

describe('validateCreateAppointment', () => {
  it('acepta ambos países y conserva los ceros iniciales del asegurado', () => {
    for (const countryISO of ['PE', 'CL']) {
      assert.deepEqual(
        validateCreateAppointment({ insuredId: '00123', scheduleId: 100, countryISO }),
        {
          ok: true,
          value: { request: { insuredId: '00123', scheduleId: 100, countryISO } },
        },
      );
    }
  });

  it('acepta una clave de idempotencia válida sin modificarla', () => {
    assert.deepEqual(
      validateCreateAppointment(
        { insuredId: '00123', scheduleId: 100, countryISO: 'PE' },
        'request-001:PE',
      ),
      {
        ok: true,
        value: {
          request: { insuredId: '00123', scheduleId: 100, countryISO: 'PE' },
          idempotencyKey: 'request-001:PE',
        },
      },
    );
  });

  it('conserva la prioridad y el orden de los errores combinados', () => {
    assert.deepEqual(validateCreateAppointment(null, ''), {
      ok: false,
      issues: [{ field: 'body', message: 'Debe ser un objeto JSON.' }],
    });
    assert.deepEqual(validateCreateAppointment({
      insuredId: '00123', scheduleId: 0, countryISO: 'PE', extra: true,
    }, ''), {
      ok: false,
      issues: [
        { field: 'extra', message: 'Campo no permitido.' },
        { field: 'scheduleId', message: 'Debe ser un entero positivo seguro.' },
        { field: 'Idempotency-Key', message: 'Debe tener entre 1 y 128 caracteres ASCII visibles, sin espacios.' },
      ],
    });
  });

  it('rechaza entradas inválidas e indica el campo incorrecto', () => {
    const cases: Array<[unknown, unknown, string]> = [
      [null, undefined, 'body'],
      [{ insuredId: 12345, scheduleId: 100, countryISO: 'PE' }, undefined, 'insuredId'],
      [{ insuredId: '1234', scheduleId: 100, countryISO: 'PE' }, undefined, 'insuredId'],
      [{ insuredId: '00123', scheduleId: 0, countryISO: 'PE' }, undefined, 'scheduleId'],
      [{ insuredId: '00123', scheduleId: 1.5, countryISO: 'PE' }, undefined, 'scheduleId'],
      [{ insuredId: '00123', scheduleId: Number.MAX_SAFE_INTEGER + 1, countryISO: 'PE' }, undefined, 'scheduleId'],
      [{ insuredId: '00123', scheduleId: 100, countryISO: 'pe' }, undefined, 'countryISO'],
      [{ insuredId: '00123', scheduleId: 100, countryISO: 'PE', date: '2026-09-24' }, undefined, 'date'],
      [{ insuredId: '00123', scheduleId: 100, countryISO: 'PE' }, '', 'Idempotency-Key'],
      [{ insuredId: '00123', scheduleId: 100, countryISO: 'PE' }, 'has spaces', 'Idempotency-Key'],
      [{ insuredId: '00123', scheduleId: 100, countryISO: 'PE' }, 'a'.repeat(129), 'Idempotency-Key'],
    ];

    for (const [body, key, field] of cases) {
      const result = validateCreateAppointment(body, key);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.issues.some((issue) => issue.field === field));
      }
    }
  });
});

describe('validateInsuredId', () => {
  it('acepta exactamente cinco dígitos en la ruta GET', () => {
    assert.deepEqual(validateInsuredId('00001'), { ok: true, value: '00001' });
  });

  it('rechaza valores inválidos en la ruta GET', () => {
    for (const value of ['1234', '123456', '12a45', ' 12345', 12345]) {
      assert.equal(validateInsuredId(value).ok, false);
    }
  });
});
