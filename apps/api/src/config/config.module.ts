import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, parseEnv } from './env.js';
import { loadEnv } from './load-env.js';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => {
        loadEnv();
        return parseEnv();
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
