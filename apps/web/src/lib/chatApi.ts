import { ApiError, call } from './api';

/* ---------- Phase 6: chat ---------- */
export interface ChatEvent {
  type: 'text' | 'tool' | 'proposal' | 'suggest' | 'error' | 'done';
  text?: string;
  name?: string;
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  label?: string;
  message?: string;
}

export const chatStatus = () =>
  call<{ claude: boolean; spentUsd: number; capUsd: number }>('GET', '/api/chat/status');
export const proposeSlot = (b: { title: string; start: string; end: string }) =>
  call<{ id: string }>('POST', '/api/plan/propose', b);

/** Stream a chat reply. Calls `onEvent` for each server-sent event as it arrives. */
export async function streamChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok || !res.body) throw new ApiError(res.status, 'request_failed');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (line.startsWith('data: ')) {
        try {
          onEvent(JSON.parse(line.slice(6)) as ChatEvent);
        } catch {
          /* skip a malformed event */
        }
      }
    }
    if (done) return;
  }
}
