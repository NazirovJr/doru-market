/**
 * `ResponseInterceptor` (EP-01, DTJ-018, SRS-API-014/015) — глобальный
 * `NestInterceptor`, оборачивающий ЛЮБОЕ возвращаемое контроллером значение в
 * `{ data: <value> }`, ЕСЛИ оно ещё не в форме `SuccessEnvelope`.
 *
 * **Правило для контроллеров (DTJ-018 §DoD):** НИ ОДИН контроллер не использует
 * собственный `try/catch` с ручным маппингом кода — `DomainExceptionFilter`
 * (DTJ-018) перехватывает `result.error` прозрачно. Аналогично, контроллеры
 * должны возвращать ЗНАЧЕНИЕ (объект/массив), а не формировать конверт вручную;
 * для списковых эндпоинтов — `ok(items, { pagination })` из
 * `packages/contracts/envelope` явно, интерсептор пропускает готовый конверт.
 *
 * Регистрация: `APP_INTERCEPTOR` в `app.module.ts` (после filters).
 */
import { CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import { map, type Observable } from 'rxjs'
import { isSuccessEnvelope } from '@dorutj/contracts'

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (isSuccessEnvelope(value)) {
          return value
        }
        return { data: value }
      }),
    )
  }
}
