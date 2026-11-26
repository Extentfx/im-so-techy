import { chat } from './chat';
import { email } from './email';
import { food } from './food';
import { gym } from './gym';
import { home } from './home';
import type { Handler } from './http';
import { plan } from './plan';
import { sleep } from './sleep';

/** Route modules added by each phase, in order. The calendar and foundation routes live in api.ts. */
export const allHandlers: Handler[] = [gym, plan, food, sleep, email, chat, home];
