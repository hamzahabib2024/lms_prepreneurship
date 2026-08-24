import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageRegistry } from "../content/storage/storage.registry";
import { ChannelRegistry } from "../notification/channel/channel.registry";
import { SimulatedOutbox } from "./simulated-outbox";
import { hasGoogleCredentials } from "../common/google-credentials";
import { ProviderRegistry } from "../live/provider/provider.registry";

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
    // Asked, not re-derived. See the live_classroom entry below.
    private readonly liveProviders: ProviderRegistry,
  ) {}

  private isSet(key: string): boolean {
    return (this.config.get<string>(key, "") ?? "").trim() !== "";
  }

  /** One question, one answer — shared with the Drive and Meet providers. */
  private get googleConfigured(): boolean {
    return hasGoogleCredentials((k) => this.config.get<string>(k, ""));
  }

  async statuses(): Promise<IntegrationStatus[]> {
    const lectureStore = this.config.get<string>("LECTURE_STORAGE", "local");
    // Asked the SAME way the Drive provider asks, so this screen cannot report
    // "not configured" for a key the provider is happily using — or the
    // reverse, which is what happened: GOOGLE_CREDENTIALS_DIR +
    // GOOGLE_SERVICE_ACCOUNT_FILE in .env are only composed into
    // GOOGLE_SERVICE_ACCOUNT_JSON by docker-compose.
    const driveConfigured = this.googleConfigured;
    const whatsappConfigured = this.channels.get("WHATSAPP")?.isConfigured() ?? false;
    // Read directly: the adapter refuses to send without it, so the screen
    // must be able to say which of the three settings is missing.
    const whatsappTemplate = this.config.get<string>("WHATSAPP_TEMPLATE_NAME", "").trim() !== "";
    // Asked of the adapter, not re-derived from the environment here — one
    // source of truth for "is this set up", so the screen cannot disagree with
    // what actually happens at send time.
    const emailConfigured = this.channels.get("EMAIL")?.isConfigured() ?? false;

    // Whether a link is MADE for the teacher or pasted in BY them — the one
    // thing a reader of this screen wants to know about live classes.
    const liveIsAutomatic = this.liveProviders
      .resolve(null)
      .capabilities().canCreateScheduledMeeting;

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
            : "Point GOOGLE_CREDENTIALS_DIR and GOOGLE_SERVICE_ACCOUNT_FILE at a service " +
              "account key with Drive API access, " +
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
        /*
         * THREE THINGS, AND THE THIRD IS THE ONE PEOPLE MISS.
         *
         * A token and a number id make the adapter live, and it will then
         * refuse every message until a template is named — because Meta
         * accepts nothing but an approved template outside a 24-hour reply
         * window, and no student has ever messaged the Institute. Saying so
         * here is cheaper than a delivery log full of suppressions.
         */
        toGoLive: whatsappConfigured && whatsappTemplate
          ? null
          : whatsappConfigured
            ? "Almost there. WHATSAPP_TEMPLATE_NAME is not set, so nothing will send: Meta " +
              "only accepts a pre-approved template outside a 24-hour reply window, and " +
              "students never message the Institute first. Create a template in WhatsApp " +
              "Manager with two body parameters — {{1}} the title, {{2}} the message — wait " +
              "for approval, then set its name and language."
            : "Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID from the Meta Business " +
              "account, and WHATSAPP_TEMPLATE_NAME to an approved template with two body " +
              "parameters. Then restart. No code change is needed — the adapter is complete.",
      },
      {
        key: "email",
        name: "Email (SMTP)",
        // Deliberately not blocked on anybody: SMTP needs a mailbox and an app
        // password, both of which the Institute already has if it has email.
        dependency: null,
        mode: emailConfigured ? "LIVE" : "NOT_CONFIGURED",
        behaviour: emailConfigured
          ? `Sent through ${this.config.get<string>("SMTP_HOST", "the configured mail server")}. ` +
            "Delivery outcomes are recorded per recipient."
          : "NOTHING IS SENT BY EMAIL. This is the channel that needs no third-party account — " +
            "any mailbox with an app password will do — and until it is set, a new account's " +
            "temporary password reaches its owner only by an administrator reading it off the " +
            "screen and telling them.",
        toGoLive: emailConfigured
          ? null
          : "Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD, then restart. For Gmail " +
            "this is smtp.gmail.com on port 587 with a 16-character App Password — not the " +
            "account's own password. See INTEGRATIONS.md.",
      },
      {
        key: "live_classroom",
        /*
         * ASKED OF THE PROVIDER THAT WILL ACTUALLY BE USED, not derived from
         * the environment here.
         *
         * This entry used to read "are there Google credentials?" and answer
         * LIVE if so — the precise mistake google-meet.provider.ts documents
         * at length: THE CREDENTIALS ARRIVING FOR ONE INTEGRATION SILENTLY
         * ARM ANOTHER. Drive and Meet share a service account, so the moment
         * a key was added for lecture video this screen began promising that
         * meeting links were created automatically, while LIVE_PROVIDER was
         * still `manual` and every teacher was still pasting links in by
         * hand. Meet additionally needs a Workspace user to act as
         * (GOOGLE_IMPERSONATE_SUBJECT) — a service account cannot create a
         * conference alone — so a key on its own is never enough.
         *
         * `canCreateScheduledMeeting` is exactly the question a reader of this
         * screen is asking: does the System make the link, or does a person?
         */
        name: `Live classes (${this.liveProviders.resolve(null).key})`,
        dependency: "DEP-01",
        mode: liveIsAutomatic ? "LIVE" : "SIMULATED",
        behaviour: liveIsAutomatic
          ? "Meeting links are created through the Google API when a class is scheduled."
          : "Meeting links are entered by hand by whoever schedules the class, and " +
            "attendance is taken manually or by student check-in. Every other part of the " +
            "timetable, the register and the attendance rules works normally.",
        toGoLive: liveIsAutomatic
          ? null
          : "Set LIVE_PROVIDER=google_meet, and GOOGLE_IMPERSONATE_SUBJECT to a Workspace " +
            "user the service account may act as — a service account cannot create a Meet " +
            "conference on its own. The key itself is the same one lecture storage uses.",
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
