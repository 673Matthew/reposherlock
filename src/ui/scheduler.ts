export interface SchedulerConfig {
  minStageMs?: number;
  minThinkingMs?: number;
  maxArtificialDelayMs?: number;
  reducedMotion?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface EnforceResult {
  actualMs: number;
  artificialDelayMs: number;
  totalVisibleMs: number;
}

export function easeOutQuad(t: number): number {
  const value = Math.max(0, Math.min(1, t));
  return 1 - (1 - value) * (1 - value);
}

export function computeArtificialDelay(input: {
  actualMs: number;
  minVisibleMs: number;
  remainingBudgetMs: number;
  reducedMotion: boolean;
}): number {
  if (input.reducedMotion) {
    return 0;
  }
  const needed = Math.max(0, input.minVisibleMs - input.actualMs);
  if (needed <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(needed, input.remainingBudgetMs));
}

export class AnimationScheduler {
  private readonly config: Required<Pick<SchedulerConfig, "minStageMs" | "minThinkingMs" | "maxArtificialDelayMs">>;
  private readonly reducedMotion: boolean;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private artificialDelayUsedMs = 0;

  constructor(config: SchedulerConfig = {}) {
    this.config = {
      minStageMs: config.minStageMs ?? 350,
      minThinkingMs: config.minThinkingMs ?? 700,
      maxArtificialDelayMs: config.maxArtificialDelayMs ?? 1200,
    };
    this.reducedMotion = Boolean(config.reducedMotion);
    this.sleepFn = config.sleep || defaultSleep;
    this.now = config.now || Date.now;
  }

  resetRun(): void {
    this.artificialDelayUsedMs = 0;
  }

  get minStageMs(): number {
    return this.config.minStageMs;
  }

  get minThinkingMs(): number {
    return this.config.minThinkingMs;
  }

  get maxArtificialDelayMs(): number {
    return this.config.maxArtificialDelayMs;
  }

  get usedArtificialDelayMs(): number {
    return this.artificialDelayUsedMs;
  }

  get remainingArtificialDelayMs(): number {
    return Math.max(0, this.config.maxArtificialDelayMs - this.artificialDelayUsedMs);
  }

  createTimestamp(): number {
    return this.now();
  }

  async enforceStageMinimum(actualMs: number, minStageMs = this.config.minStageMs): Promise<EnforceResult> {
    return this.enforceMinimum(actualMs, minStageMs);
  }

  async enforceThinkingMinimum(actualMs: number, minThinkingMs = this.config.minThinkingMs): Promise<EnforceResult> {
    return this.enforceMinimum(actualMs, minThinkingMs);
  }

  async enforceSince(startedAtMs: number, minVisibleMs: number): Promise<EnforceResult> {
    const actualMs = Math.max(0, this.now() - startedAtMs);
    return this.enforceMinimum(actualMs, minVisibleMs);
  }

  private async enforceMinimum(actualMs: number, minVisibleMs: number): Promise<EnforceResult> {
    const artificialDelayMs = computeArtificialDelay({
      actualMs,
      minVisibleMs,
      remainingBudgetMs: this.remainingArtificialDelayMs,
      reducedMotion: this.reducedMotion,
    });

    if (artificialDelayMs > 0) {
      this.artificialDelayUsedMs += artificialDelayMs;
      await this.sleepFn(artificialDelayMs);
    }

    return {
      actualMs,
      artificialDelayMs,
      totalVisibleMs: actualMs + artificialDelayMs,
    };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
