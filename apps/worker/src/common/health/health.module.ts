import { Module } from '@nestjs/common'
import { HealthService } from './health.service.js'

@Module({
  providers: [HealthService],
  exports: [HealthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- носитель декоратора @Module.
export class HealthModule {}
