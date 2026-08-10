/**
 * Who gets pushed, and when — SRS FR-COM-018, BR-COM-02.
 *
 * A pure module, because these rules decide whether a person's phone lights up
 * at 3am and they are easier to get subtly wrong than they look. Quiet hours
 * that wrap past midnight are the obvious trap; "urgent" overriding a mute is
 * the less obvious one.
 *
 * THE INBOX COPY IS NEVER SUPPRESSED. Everything here decides only whether to
 * PUSH. A student who has muted assignment reminders still finds them in their
 * inbox, because muting means "stop interrupting me", not "keep this from me" —
 * and a System that withheld a deadline because of a preference would be doing
 * something nobody asked for.
 */

export interface Preference {
  /** Channels the user accepts. IN_APP is implicit and cannot be removed. */
  channels: string[];
  mutedKinds: string[];
  /** Local hour, 0-23. Inclusive start, exclusive end. Null means no quiet hours. */
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

export type PushDecision =
  | { push: true }
  | { push: false; reason: "MUTED" | "CHANNEL_OFF" | "QUIET_HOURS" };

/**
 * Whether `hour` falls inside the quiet window.
 *
 * Handles a window that wraps past midnight, which is the normal case: 22 to 7
 * is quiet at 23:00 and at 02:00, and NOT at 12:00. Treating it as a simple
 * start <= h < end would make that window match nothing at all, and the bug
 * would only show up as "notifications arrive at night".
 */
export function isWithinQuietHours(
  hour: number,
  start: number | null,
  end: number | null,
): boolean {
  if (start === null || end === null) return false;
  if (start === end) return false; // a zero-width window silences nothing
  return start < end
    ? hour >= start && hour < end // 1..6
    : hour >= start || hour < end; // 22..7, wrapping
}

/**
 * Decides whether to push one message to one person on one channel.
 *
 * Returns a reason rather than a bare false, because the reason is written to
 * the delivery record and "why did I not get that?" is answerable only if it
 * was kept.
 */
export function shouldPush(input: {
  channel: string;
  kind: string;
  isUrgent: boolean;
  /** The recipient's LOCAL hour, resolved by the caller from their timezone. */
  localHour: number;
  preference: Preference;
}): PushDecision {
  const { channel, kind, isUrgent, localHour, preference } = input;

  // Urgent overrides mute and quiet hours, but NOT the channel list. A user who
  // has turned WhatsApp off has withdrawn consent for that channel, and an
  // urgent message does not restore it — it goes to the inbox instead
  // (BR-COM-02).
  if (!preference.channels.includes(channel)) {
    return { push: false, reason: "CHANNEL_OFF" };
  }

  if (isUrgent) return { push: true };

  if (preference.mutedKinds.includes(kind)) {
    return { push: false, reason: "MUTED" };
  }

  if (isWithinQuietHours(localHour, preference.quietHoursStart, preference.quietHoursEnd)) {
    return { push: false, reason: "QUIET_HOURS" };
  }

  return { push: true };
}

/** The local hour for an IANA timezone, used to evaluate quiet hours. */
export function localHourIn(timezone: string, at: Date): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(at);
    const hour = Number.parseInt(formatted, 10);
    return Number.isFinite(hour) ? hour % 24 : at.getUTCHours();
  } catch {
    // An unknown timezone must not stop a notification. Falling back to UTC
    // may mistime a quiet-hours check; refusing to send would lose the message.
    return at.getUTCHours();
  }
}
