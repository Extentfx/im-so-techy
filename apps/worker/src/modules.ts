import { food } from './food';
import { gym } from './gym';
import type { Handler } from './http';
import { plan } from './plan';

/** Route modules added by each phase, in order. The calendar and foundation routes live in api.ts. */
export const allHandlers: Handler[] = [gym, plan, food];
