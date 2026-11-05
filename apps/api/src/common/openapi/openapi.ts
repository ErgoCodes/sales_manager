import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/** Version of the HTTP contract (not of the build), so the generated file is stable. */
export const API_CONTRACT_VERSION = '0.1.0';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Mercado Mónaco API')
    .setDescription('Back-office and sync API. Errors always use the `ErrorResponse` schema.')
    .setVersion(API_CONTRACT_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token (EdDSA JWT, 10 min)' })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  return cleanupOpenApiDoc(document);
}
