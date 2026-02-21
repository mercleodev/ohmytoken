import { SseEvent, SseEventType } from './types';

export class SseParser {
  private buffer = '';

  processChunk(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    // Split events by \n\n separator
    let separatorIndex: number;
    while ((separatorIndex = this.buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = this.buffer.slice(0, separatorIndex);
      this.buffer = this.buffer.slice(separatorIndex + 2);

      const parsed = this.parseEvent(rawEvent);
      if (parsed) {
        events.push(parsed);
      }
    }

    return events;
  }

  flush(): SseEvent[] {
    if (!this.buffer.trim()) {
      return [];
    }

    const parsed = this.parseEvent(this.buffer);
    this.buffer = '';
    return parsed ? [parsed] : [];
  }

  private parseEvent(raw: string): SseEvent | null {
    const lines = raw.split('\n');
    let eventType = '';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        data = line.slice(6);
      }
    }

    if (!eventType || !data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      const type = (parsed.type || eventType) as SseEventType;

      const event: SseEvent = { type, raw };

      if (type === 'message_start' && parsed.message?.usage) {
        const usage = parsed.message.usage;
        event.input_tokens = usage.input_tokens ?? 0;
        event.cache_creation_input_tokens = usage.cache_creation_input_tokens ?? 0;
        event.cache_read_input_tokens = usage.cache_read_input_tokens ?? 0;
      }

      if (type === 'message_delta' && parsed.usage) {
        event.output_tokens = parsed.usage.output_tokens ?? 0;
      }

      return event;
    } catch {
      // On JSON parse error, skip only this event
      return null;
    }
  }
}
