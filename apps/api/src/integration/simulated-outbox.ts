import { Injectable } from "@nestjs/common";

export interface SimulatedMessage {
  at: Date;
  channel: string;
  kind: string;
  /** Who it would have gone to, and by what address. */
  recipientName: string;
  destination: string;
  title: string;
  body: string;
  isUrgent: boolean;
}

/**
 * What WOULD have been sent, had the credentials existed.
 *
 * DEP-04 is not resolved, so nothing reaches Meta. Until this existed the whole
 * messaging pipeline ran correctly and invisibly: preferences, quiet hours,
 * muting and the delivery record all worked, and the only way to see the actual
 * wording a student would receive was to read the source. That made the feature
 * impossible to demonstrate and impossible to proofread.
 *
 * THIS IS NOT A DELIVERY LOG AND MUST NEVER BE READ AS ONE. The delivery log
 * lives in the database and records SUPPRESSED for every one of these, which is
 * the truth — nothing left the building. This is a development aid that holds
 * the rendered text so somebody can look at it.
 *
 * IN MEMORY, AND BOUNDED, ON PURPOSE. These bodies carry marks, attendance
 * warnings and outstanding balances (SEC-PRV-003). Writing them to a table
 * would create a second, permanent, differently-guarded copy of exactly the
 * data the notification system is careful with — and one that would outlive the
 * simulation it exists for. A restart clears it, which is the correct
 * durability for something that only exists because production is not
 * configured.
 */
@Injectable()
export class SimulatedOutbox {
  /** Small deliberately: this is for looking at the last few, not archiving. */
  static readonly LIMIT = 50;

  private messages: SimulatedMessage[] = [];

  record(message: SimulatedMessage): void {
    this.messages.unshift(message);
    if (this.messages.length > SimulatedOutbox.LIMIT) {
      this.messages.length = SimulatedOutbox.LIMIT;
    }
  }

  /** Newest first. A copy, so a caller cannot mutate the buffer. */
  recent(limit = SimulatedOutbox.LIMIT): SimulatedMessage[] {
    return this.messages.slice(0, Math.max(0, Math.min(limit, SimulatedOutbox.LIMIT)));
  }

  count(): number {
    return this.messages.length;
  }

  clear(): void {
    this.messages = [];
  }
}
