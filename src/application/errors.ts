export class IdempotencyConflictError extends Error {
  constructor() {
    super('La clave de idempotencia ya pertenece a otra solicitud.');
    this.name = 'IdempotencyConflictError';
  }
}

export class AppointmentDispatchError extends Error {
  constructor(
    readonly appointmentId: string,
    cause: unknown,
  ) {
    super('La solicitud se registró, pero no se pudo confirmar su envío para procesamiento.', {
      cause,
    });
    this.name = 'AppointmentDispatchError';
  }
}
