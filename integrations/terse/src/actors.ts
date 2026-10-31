import { Actor, Persisted, Emittable } from 'durable-actors';

// The actor owns session state; the Node service only stores video/frame bytes.
// JSON strings keep the generated RPC contract small and explicit.
export class EvaluationSession extends Actor {
  @Persisted @Emittable stateJson = '{}';

  async initialize(json: string): Promise<string> {
    if (this.stateJson !== '{}') return this.stateJson;
    const input = JSON.parse(json);
    if (!input.task || !Array.isArray(input.criteria)) throw new Error('Task and criteria are required');
    this.stateJson = JSON.stringify({ ...input, id: this.id, status: 'live', created: new Date().toISOString(),
      frames: [], observations: [], reviews: [], messages: [], events: [], processedSeq: -1,
      stopRequested: false, lease: null, pending: null, updated: new Date().toISOString() });
    return this.stateJson;
  }

  async snapshot(): Promise<string> { return this.stateJson; }

  async attachRecording(jobId: string, videoUrl: string): Promise<string> {
    const s = JSON.parse(this.stateJson);
    if (s.sourceKind !== 'browser_capture') throw new Error('Only browser captures accept a recording');
    s.recordingJobId = jobId; s.videoUrl = videoUrl; s.updated = new Date().toISOString();
    this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async appendFrame(json: string): Promise<string> {
    const s = JSON.parse(this.stateJson), frame = JSON.parse(json);
    if (s.status !== 'live') throw new Error('Session is no longer accepting frames');
    if (!Number.isInteger(frame.seq) || frame.seq < 0 || !Number.isFinite(frame.seconds) || frame.seconds < 0) throw new Error('Invalid frame metadata');
    if (s.frames.some((f: any) => f.seq === frame.seq)) return this.stateJson;
    if (s.frames.length && frame.seq <= s.frames[s.frames.length - 1].seq) throw new Error('Frames must arrive in increasing sequence order');
    if (s.frames.length >= 1200) throw new Error('Session frame limit reached');
    s.frames.push(frame); s.updated = new Date().toISOString();
    this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async claim(seq: number, token: string): Promise<boolean> {
    const s = JSON.parse(this.stateJson);
    if (!['live','finishing'].includes(s.status) || seq <= s.processedSeq) return false;
    if (s.lease && s.lease.until > Date.now()) return false;
    s.lease = { seq, token, until: Date.now() + 180000 };
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return true;
  }

  async saveObservation(token: string, json: string): Promise<string> {
    const s = JSON.parse(this.stateJson);
    if (!s.lease || s.lease.token !== token) throw new Error('Evaluation lease changed');
    const observation = JSON.parse(json);
    s.pending = observation;
    if (!s.observations.some((o: any) => o.token === token || (observation.observation?.responseId && o.observation?.responseId === observation.observation.responseId))) s.observations.push({ ...observation, token });
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async saveProgress(json: string): Promise<string> {
    const s = JSON.parse(this.stateJson), observation = JSON.parse(json);
    if (observation.seq > (s.observations.at(-1)?.seq ?? -1)) s.observations.push(observation);
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async completeReview(token: string, json: string): Promise<string> {
    const s = JSON.parse(this.stateJson);
    if (!s.lease || s.lease.token !== token) return this.stateJson;
    const result = JSON.parse(json);
    s.reviews.push(result); s.processedSeq = s.lease.seq; s.pending = null; s.lease = null;
    s.lastError = null;
    if (s.stopRequested && s.frames.at(-1)?.seq <= s.processedSeq) s.status = 'completed';
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async saveReviewDraft(token: string, json: string): Promise<string> {
    const s = JSON.parse(this.stateJson);
    if (!s.lease || s.lease.token !== token || !s.pending) throw new Error('Evaluation lease changed');
    s.pending.review = JSON.parse(json);
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async renewLease(token: string): Promise<boolean> {
    const s = JSON.parse(this.stateJson);
    if (s.lease?.token !== token || !s.pending) return false;
    s.lease.until = Date.now() + 180000;
    this.stateJson = JSON.stringify(s); return true;
  }

  async addMessage(json: string): Promise<string> {
    const s = JSON.parse(this.stateJson), message = JSON.parse(json);
    const existing = s.messages.find((m: any) => m.id === message.id);
    if (existing) Object.assign(existing, message); else s.messages.push(message);
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async recordError(token: string, message: string): Promise<string> {
    const s = JSON.parse(this.stateJson);
    // Keep checkpointed work and its stable delivery key on transport errors.
    if (s.lease?.token === token && !s.pending) s.lease = null;
    s.lastError = message; s.events.push({ at: new Date().toISOString(), message });
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return this.stateJson;
  }

  async finish(reason: string): Promise<string> {
    const s = JSON.parse(this.stateJson);
    if (s.stopRequested) return this.stateJson;
    s.stopRequested = true;
    s.stopReason = reason;
    s.status = !s.frames.length || s.frames.at(-1).seq <= s.processedSeq ? 'completed' : 'finishing';
    s.updated = new Date().toISOString(); this.stateJson = JSON.stringify(s); return this.stateJson;
  }
}

export class SessionDirectory extends Actor {
  @Persisted ids: string[] = [];
  async add(id: string): Promise<string[]> { if (!this.ids.includes(id)) this.ids = [...this.ids, id]; return this.ids; }
  async list(): Promise<string[]> { return this.ids; }
}
