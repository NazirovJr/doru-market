import { Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'

interface OtpPeekable {
  peekLastFor(phone: string): { readonly code: string } | null
}

function isOtpPeekable(sms: SmsProviderPort): sms is SmsProviderPort & OtpPeekable {
  return typeof (sms as Partial<OtpPeekable>).peekLastFor === 'function'
}

// Выключенный флаг неотличим от несуществующего маршрута — стенд не светит сам факт эндпоинта.
@Controller({ path: '_test', version: '1' })
export class E2eLastOtpController {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProviderPort,
  ) {}

  @Public()
  @Get('last-otp')
  lastOtp(@Query('phone') phone: string | undefined): SuccessEnvelope<{ code: string }> {
    const sms = this.sms
    if (!this.config.e2eTestEndpoints || !isOtpPeekable(sms)) {
      throw new NotFoundException()
    }
    const record = phone === undefined ? null : sms.peekLastFor(phone)
    if (record === null) {
      throw new NotFoundException()
    }
    return ok({ code: record.code })
  }
}
