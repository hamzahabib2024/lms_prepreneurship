/**
 * Notification channels — SRS ARC-046, DEP-04.
 *
 * The same provider-independence obligation as the LCAL (ARC-001) and storage
 * (ARC-043), for the same reason: the Institute reaches students on WhatsApp
 * today, and that must be a configuration choice rather than something woven
 * through the System.
 *
 * NOTHING BELOW THIS INTERFACE MAY NAME A VENDOR. A caller asks for a message
 * to reach a person; which channel carries it, and whether that channel is
 * WhatsApp, email or a line in a log, is resolved by the registry.
 *
 * THE IN-APP COPY IS THE RECORD. A channel is a DELIVERY of a notification, not
 * the notification itself, so a failed or unconfigured channel never loses the
 * message — the recipient still finds it in their inbox. That is what lets the
 * System run correctly today, before any messaging credentials exist (DEP-04),
 * rather than waiting on them.
 */

export interface OutboundMessage {
  /** Stable machine key, e.g. "grade.released". Chooses the template. */
  kind: string;
  title: string;
  body: string;
  /** Relative path in the System. Never a provider URL (ARC-023). */
  linkPath: string | null;
  /** BR-COM-02 — an urgent message ignores quiet hours. */
  isUrgent: boolean;
}

export interface Recipient {
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  phoneIsWhatsapp: boolean;
}

export interface DeliveryOutcome {
  /** SENT, or FAILED, or SUPPRESSED when the channel declined to try. */
  status: "SENT" | "FAILED" | "SUPPRESSED";
  /**
   * Why. Written for whoever reads the delivery log later, and it must
   * distinguish "we chose not to" from "we tried and could not" — treating a
   * suppression as a failure produces an alert nobody should act on.
   */
  detail: string;
}

export interface NotificationChannelAdapter {
  /** Matches the NotificationChannel enum value this adapter serves. */
  readonly channel: "IN_APP" | "WHATSAPP" | "EMAIL" | "SMS";

  /**
   * Whether this channel can be used at all right now.
   *
   * An adapter with no credentials reports false rather than throwing on every
   * send: an unconfigured channel is an expected state during rollout, not an
   * incident.
   */
  isConfigured(): boolean;

  /** Whether this particular recipient can be reached on this channel. */
  canReach(recipient: Recipient): boolean;

  send(recipient: Recipient, message: OutboundMessage): Promise<DeliveryOutcome>;
}
