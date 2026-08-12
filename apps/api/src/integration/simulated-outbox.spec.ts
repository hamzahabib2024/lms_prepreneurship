import { SimulatedOutbox, type SimulatedMessage } from "./simulated-outbox";

const message = (title: string): SimulatedMessage => ({
  at: new Date(),
  channel: "WHATSAPP",
  kind: "grade.released",
  recipientName: "Ayesha Khan",
  destination: "+92 300 0000000",
  title,
  body: "Your mark is available.",
  isUrgent: false,
});

describe("the simulated outbox", () => {
  let outbox: SimulatedOutbox;
  beforeEach(() => {
    outbox = new SimulatedOutbox();
  });

  it("starts empty", () => {
    expect(outbox.count()).toBe(0);
    expect(outbox.recent()).toEqual([]);
  });

  it("keeps what it is given, newest first", () => {
    outbox.record(message("first"));
    outbox.record(message("second"));
    expect(outbox.recent().map((m) => m.title)).toEqual(["second", "first"]);
  });

  it("NEVER grows past its limit", () => {
    // The reason it is bounded: these bodies carry marks, attendance warnings
    // and balances. An unbounded buffer is an unbounded, unguarded second copy
    // of exactly the data the notification system is careful with.
    for (let i = 0; i < SimulatedOutbox.LIMIT + 25; i++) outbox.record(message(`m${i}`));
    expect(outbox.count()).toBe(SimulatedOutbox.LIMIT);
  });

  it("discards the OLDEST when it overflows, not the newest", () => {
    for (let i = 0; i < SimulatedOutbox.LIMIT + 1; i++) outbox.record(message(`m${i}`));
    const titles = outbox.recent().map((m) => m.title);
    expect(titles[0]).toBe(`m${SimulatedOutbox.LIMIT}`);
    expect(titles).not.toContain("m0");
  });

  it("caps a caller asking for more than the limit", () => {
    for (let i = 0; i < SimulatedOutbox.LIMIT; i++) outbox.record(message(`m${i}`));
    expect(outbox.recent(10_000)).toHaveLength(SimulatedOutbox.LIMIT);
    expect(outbox.recent(3)).toHaveLength(3);
  });

  it("treats a negative or absurd limit as none rather than throwing", () => {
    outbox.record(message("one"));
    expect(outbox.recent(-5)).toEqual([]);
    expect(outbox.recent(0)).toEqual([]);
  });

  it("hands back a COPY, so a reader cannot empty the buffer", () => {
    outbox.record(message("kept"));
    const read = outbox.recent();
    read.length = 0;
    expect(outbox.count()).toBe(1);
  });

  it("clears on request", () => {
    outbox.record(message("gone"));
    outbox.clear();
    expect(outbox.count()).toBe(0);
    expect(outbox.recent()).toEqual([]);
  });
});
