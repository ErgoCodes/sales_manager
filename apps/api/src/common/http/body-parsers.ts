import { HttpException } from '@nestjs/common';
import { json, type NextFunction, type Request, type RequestHandler, type Response, urlencoded } from 'express';

export const BODY_LIMIT = '100kb';

/**
 * Fixed messages for body-parser errors. Their own text can quote the payload
 * (a JSON SyntaxError does), so it is never echoed to the client.
 */
export const BODY_PARSER_MESSAGES: Record<string, string> = {
  'entity.parse.failed': 'Malformed JSON body',
  'entity.too.large': 'Payload too large',
  'encoding.unsupported': 'Unsupported content encoding',
  'charset.unsupported': 'Unsupported charset',
};

/**
 * Nest turns any SyntaxError into `BadRequestException(err.message)` before
 * filters see it, so body-parser errors are converted here, at the source.
 */
export function toBodyParserException(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const { status, type, expose } = error as { status?: unknown; type?: unknown; expose?: unknown };
  if (typeof status !== 'number' || status < 400 || status >= 500 || expose !== true) return error;
  const message = typeof type === 'string' ? BODY_PARSER_MESSAGES[type] : undefined;
  return new HttpException(message ?? 'Invalid request', status);
}

function guarded(parser: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) =>
    parser(req, res, (error?: unknown) => (error ? next(toBodyParserException(error)) : next()));
}

/**
 * Body parsers registered as Nest middleware (AppModule.configure) instead of
 * `app.use`: Nest runs global modules' middleware first, so nestjs-pino has
 * already assigned the request id when a body fails to parse (400/413), and
 * those responses are logged and carry `x-request-id`.
 */
export function bodyParsers(): RequestHandler[] {
  return [json({ limit: BODY_LIMIT }), urlencoded({ limit: BODY_LIMIT, extended: false })].map(guarded);
}
