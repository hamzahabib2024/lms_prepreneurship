import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageRegistry } from "../content/storage/storage.registry";
import { ChannelRegistry } from "../notification/channel/channel.registry";
import { SimulatedOutbox } from "./simulated-outbox";

/** LIVE talks to the real provider. The other two do not, differently. */
export type IntegrationMode = "LIVE" | "SIMULATED" | "NOT_CONFIGURED";

export interface IntegrationStatus {
  key: string;
  name: string;
  /** The SRS dependency this is blocked on, where there is one. */
  dependency: string | null;
  mode: IntegrationMode;
  /** What the System does right now, in a sentence somebody can act on. */
  behaviour: string;
  /** What is needed to move it to LIVE. Never names a secret's value. */
  toGoLive: string | null;
}

/**
 * What is actually connected — SRS §3.4, DEP-01 and DEP-04.
 *
 * ONE PLACE THAT ANSWERS THE QUESTION HONESTLY. The Institute will run this
 * System for a while before the Google and Meta credentials arrive, and the
 * failure mode that matters is not an outage — it is somebody assuming a
 * message went out. A fee reminder that was never delivered and a fee reminder
 * that was delivered look identical from the office unless something says so.
 *
 * So every external dependency reports one of three states, and the two that
 * are not LIVE are never described in language that could be mistaken for it.
 * SIMULATED means the System did the work and threw the result away on
 * purpose; NOT_CONFIGURED means it declined to try.
 *
 * NO SECRET IS EVER RETURNED HERE, not even partially. SEC-CRY-010 makes
 * credentials write-only for every role including a Super Admin, so this
 * reports whether something is set, never what it is.
 */
@Injectable()
export class IntegrationService {
  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageRegistry,
    private readonly channels: ChannelRegistry,
    private readonly outbox: SimulatedOutbox,
  ) {}

  private isSet(key: string): boolean {
    return (this.config.get<string>(key, "") ?? "").trim() !== "";
  }

  async statuses(): Promise<IntegrationStatus[]> {
    const lectureStore = this.config.get<string>("LECTURE_STORAGE", "local");
    const driveConfigured = this.isSet("GOOGLE_SERVICE_ACCOUNT_JSON");
    const whatsappConfigured = this.channels.get("WHATSAPP")?.isConfigured() ?? false;

    const storageHealth = await this.storage.listWithHealth();
    const driveHealth = storageHealth.find((s) => s.key === "google_drive");

    return [
      {
        key: "lecture_storage",
        name: "Lecture video (Google Drive)",
        dependency: "DEP-01",
        mode: driveConfigured && lectureStore === "google_drive" ? "LIVE" : "SIMULATED",
        behaviour:
          driveConfigured && lectureStore === "google_drive"
            ? "Lectures are catalogued from and streamed out of the Institute's Drive."
            : `Lectures are served from local storage instead (LECTURE_STORAGE=${lectureStore}). ` +
              "Cataloguing, publication, playback and the weekly integrity sweep all work; " +
              "the files simply live on this server rather than in Drive." +
              (driveHealth?.health.detail ? ` Drive reports: ${driveHealth.health.detail}` : ""),
        toGoLive:
          driveConfigured && lectureStore === "google_drive"
            ? null
            : "Set GOOGLE_SERVICE_ACCOUNT_JSON to a service account with Drive API access, " +
              "then set LECTURE_STORAGE=google_drive.",
      },
      {
        key: "document_storage",
        name: "Documents (payment slips, submissions)",
        dependency: null,
        // Never blocked on anybody: the System holds these itself by design.
        mode: "LIVE",
        behaviour:
          `Held by the System in ${this.config.get<string>("DOCUMENT_STORAGE", "local")} storage. ` +
          "Payment slips and submissions are deliberately not in Drive — they are the " +
          "Institute's records, not shared media.",
        toGoLive: null,
      },
      {
        key: "whatsapp",
        name: "WhatsApp messages (Meta)",
        dependency: "DEP-04",
        mode: whatsappConfigured ? "LIVE" : "SIMULATED",
        behaviour: whatsappConfigured
          ? "Messages are handed to Meta and the delivery log records the outcome."
          : "NOTHING IS SENT. The full pipeline runs — preferences, quiet hours, muting and " +
            "the delivery record — and every WhatsApp delivery is recorded SUPPRESSED, which " +
            `is the truth. The wording is kept in the simulator outbox (${this.outbox.count()} ` +
            "held) so it can be read and proofread. Recipients still get the message in their " +
            "in-app inbox, which is the record.",
        toGoLive: whatsappConfigured
          ? null
          : "Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID from the Meta Business " +
            "account, then restart. No other change is needed — the adapter already " +
            "implements the full contract.",
      },
      {
        key: "live_classroom",
        name: "Live classes (Google Meet)",
        dependency: "DEP-01",
        mode: this.isSet("GOOGLE_SERVICE_ACCOUNT_JSON") ? "LIVE" : "SIMULATED",
        behaviour: this.isSet("GOOGLE_SERVICE_ACCOUNT_JSON")
          ? "Meeting links are created through the Google API."
          : "Meeting links are entered by hand by whoever schedules the class, and " +
            "attendance is taken manually or by student check-in. Every other part of the " +
            "timetable, the register and the attendance rules works normally.",
        toGoLive: this.isSet("GOOGLE_SERVICE_ACCOUNT_JSON")
          ? null
          : "The same service account as lecture storage, with the Calendar and Meet scopes.",
      },
    ];
  }

  /**
   * The simulated messages themselves.
   *
   * Guarded more tightly than the status list above, and not by accident: a
   * notification body can carry a mark, an attendance warning or an outstanding
   * balance, so this is not readable by everyone who may see WHICH providers are
   * connected.
   */
  outboxMessages(limit?: number) {
    return {
      messages: this.outbox.recent(limit),
      held: this.outbox.count(),
      limit: SimulatedOutbox.LIMIT,
      note:
        "These were NOT sent. Each one is recorded SUPPRESSED in the delivery log, and this " +
        "buffer is cleared when the server restarts.",
    };
  }

  clearOutbox(): { cleared: number } {
    const cleared = this.outbox.count();
    this.outbox.clear();
    return { cleared };
  }
}
