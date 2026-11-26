import { describe, expect, it } from 'vitest';
import { parseSse } from './sse';

const stream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
      c.close();
    },
  });

describe('parseSse', () => {
  it('parses events split across chunks and skips malformed ones', async () => {
    const out = [];
    for await (const e of parseSse(
      stream([
        'event: a\ndata: {"x":1}\n\nevent: b\nda',
        'ta: {"y":2}\n\ndata: not json\n\n',
        'event: c\r\ndata: {"z":3}\r\n\r\n',
      ]),
    ))
      out.push(e);
    expect(out).toEqual([
      { event: 'a', data: { x: 1 } },
      { event: 'b', data: { y: 2 } },
      { event: 'c', data: { z: 3 } },
    ]);
  });
});
