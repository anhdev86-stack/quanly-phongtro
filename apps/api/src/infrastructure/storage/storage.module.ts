import { Global, Module } from '@nestjs/common';
import path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { LocalStorageAdapter, STORAGE } from './storage.js';

@Global()
@Module({
  providers: [{ provide: STORAGE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new LocalStorageAdapter(path.resolve(config.STORAGE_DIR)) }],
  exports: [STORAGE],
})
export class StorageModule {}
