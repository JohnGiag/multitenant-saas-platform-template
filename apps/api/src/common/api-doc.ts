import { SetMetadata } from '@nestjs/common';
import type { z } from 'zod';

export const API_DOC_KEY = 'apiDoc';

export interface ApiDocMetadata {
  summary: string;
  // The 2xx body's schema; null for none. Omitted is only allowed for 204.
  response?: z.ZodType | null;
}

// Every route's summary and response schema for the OpenAPI document (/docs). Everything else (body, query, path
// parameters, roles, security, status) is read from the route itself, so the document cannot drift from the code.
export const ApiDoc = (summary: string, response?: z.ZodType | null) =>
  SetMetadata(API_DOC_KEY, { summary, response } satisfies ApiDocMetadata);
