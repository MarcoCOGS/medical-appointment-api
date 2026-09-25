# Modelo DynamoDB

Una tabla bajo demanda con claves de texto `PK` y `SK`:

| Registro | PK | SK | Datos |
| --- | --- | --- | --- |
| Cita | `INSURED#insuredId` | `APPOINTMENT#appointmentId` | Solicitud, estado y fechas |
| Idempotencia | `IDEMPOTENCY#SHA-256(clave)` | `REQUEST` | Huella del cuerpo y referencia a la cita |

`GET /appointments/{insuredId}` consulta la partición del asegurado con `Query` consistente y paginada; devuelve las citas por `createdAt` descendente.

Con `Idempotency-Key`, una transacción crea ambos registros. Repetir la clave y el cuerpo recupera la misma cita; cambiar el cuerpo produce conflicto. La clave original no se guarda. El `appointmentId` persistido se conserva en los mensajes; `publishedAt` registra el envío a SNS y no aparece en la API.
