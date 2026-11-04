import { type DynamicModule, Module } from '@nestjs/common';

import { APP_CONFIG } from './app-config.token';
import type { AppConfig } from './env';

/** Makes the validated config injectable everywhere via {@link APP_CONFIG}. */
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
