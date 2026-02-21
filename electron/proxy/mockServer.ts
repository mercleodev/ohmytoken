import * as http from 'http';

const MOCK_SSE_EVENTS = [
  {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_mock_001',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-6-20250514',
        content: [],
        stop_reason: null,
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 200,
        },
      },
    },
  },
  {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello! ' },
    },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'This is a mock response.' },
    },
  },
  {
    event: 'content_block_stop',
    data: { type: 'content_block_stop', index: 0 },
  },
  {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 50 },
    },
  },
  {
    event: 'message_stop',
    data: { type: 'message_stop' },
  },
];

const formatSseEvent = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export const createMockServer = (port: number): http.Server => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/messages') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        let i = 0;
        const sendNext = (): void => {
          if (i < MOCK_SSE_EVENTS.length) {
            const evt = MOCK_SSE_EVENTS[i];
            res.write(formatSseEvent(evt.event, evt.data));
            i++;
            setTimeout(sendNext, 10);
          } else {
            res.end();
          }
        };
        sendNext();
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, () => {
    console.log(`Mock Anthropic server listening on port ${port}`);
  });

  return server;
};

// When run directly from CLI
if (require.main === module) {
  const port = parseInt(process.argv[2] || '8781', 10);
  createMockServer(port);
}
