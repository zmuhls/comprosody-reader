export type ImprovementOutcome =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'discarded';

export type ImprovementFormFactor = 'phone' | 'tablet' | 'desktop';

interface ImprovementEventBase {
  outcome: ImprovementOutcome;
  durationMs?: number;
}

export type ImprovementEvent =
  | (ImprovementEventBase & {
      eventType: 'transcription';
      provider: 'local' | 'elevenlabs';
      outputUnits?: number;
      audioDurationMs?: number;
      keytermCount?: number;
    })
  | (ImprovementEventBase & {
      eventType: 'refinement';
      provider: 'ollama';
      mode: 'faithful' | 'overhaul' | 'selection' | 'variants';
      autoTriggered: boolean;
      inputUnits?: number;
      outputUnits?: number;
    })
  | (ImprovementEventBase & {
      eventType: 'speech_synthesis';
      provider: 'elevenlabs';
      speechSpeed: number;
      inputUnits?: number;
    });

const EVENT_ENDPOINT = '/api/improvement-events';

/**
 * Coarse viewport class only. No user-agent, device model, IP, installation,
 * session, user, or note identifier is collected.
 */
export function improvementFormFactor(
  viewportWidth: number,
): ImprovementFormFactor {
  if (viewportWidth <= 600) return 'phone';
  if (viewportWidth <= 1_024) return 'tablet';
  return 'desktop';
}

export function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function currentFormFactor(): ImprovementFormFactor {
  return improvementFormFactor(
    typeof window === 'undefined' ? 1_280 : window.innerWidth,
  );
}

function boundedInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

export function buildImprovementEventPayload(event: ImprovementEvent) {
  const base = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    eventType: event.eventType,
    outcome: event.outcome,
    provider: event.provider,
    formFactor: currentFormFactor(),
    durationMs: boundedInteger(event.durationMs),
  };

  if (event.eventType === 'transcription') {
    return {
      ...base,
      outputUnits: boundedInteger(event.outputUnits),
      audioDurationMs: boundedInteger(event.audioDurationMs),
      keytermCount: boundedInteger(event.keytermCount),
    };
  }
  if (event.eventType === 'refinement') {
    return {
      ...base,
      mode: event.mode,
      autoTriggered: event.autoTriggered,
      inputUnits: boundedInteger(event.inputUnits),
      outputUnits: boundedInteger(event.outputUnits),
    };
  }
  return {
    ...base,
    speechSpeed: event.speechSpeed,
    inputUnits: boundedInteger(event.inputUnits),
  };
}

/**
 * Best-effort operational telemetry. Failures never block transcription,
 * refinement, editing, or listening. The receiving API has a strict allowlist
 * that rejects content fields.
 */
export async function recordImprovementEvent(
  event: ImprovementEvent,
): Promise<boolean> {
  try {
    const body = JSON.stringify({
      events: [buildImprovementEventPayload(event)],
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(
        EVENT_ENDPOINT,
        new Blob([body], { type: 'application/json' }),
      );
      if (accepted) return true;
    }
    if (typeof fetch === 'undefined') return false;
    const response = await fetch(EVENT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}
