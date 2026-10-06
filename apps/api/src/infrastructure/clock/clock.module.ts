import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { CLOCK, SystemClock } from './clock.js';

@Global()
@Module({
  providers: [
    {
      provide: CLOCK,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SystemClock(config.BUSINESS_TIMEZONE),
    },
  ],
  exports: [CLOCK],
})
export class ClockModule {}
