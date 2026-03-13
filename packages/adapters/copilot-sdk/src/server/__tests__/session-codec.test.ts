import { describe, expect, it } from "vitest";
import { sessionCodec } from "../index.js";

describe("sessionCodec.deserialize", () => {
  it("returns null for non-object inputs", () => {
    expect(sessionCodec.deserialize(null)).toBeNull();
    expect(sessionCodec.deserialize(undefined)).toBeNull();
    expect(sessionCodec.deserialize("string")).toBeNull();
    expect(sessionCodec.deserialize(42)).toBeNull();
    expect(sessionCodec.deserialize([])).toBeNull();
  });

  it("returns null when sessionId is missing or empty", () => {
    expect(sessionCodec.deserialize({})).toBeNull();
    expect(sessionCodec.deserialize({ sessionId: "" })).toBeNull();
    expect(sessionCodec.deserialize({ sessionId: "  " })).toBeNull();
  });

  it("deserializes a valid payload with sessionId and cwd", () => {
    const result = sessionCodec.deserialize({ sessionId: "sess_abc", cwd: "/workspace" });
    expect(result).toEqual({ sessionId: "sess_abc", cwd: "/workspace" });
  });

  it("deserializes without cwd when omitted", () => {
    const result = sessionCodec.deserialize({ sessionId: "sess_xyz" });
    expect(result).toEqual({ sessionId: "sess_xyz" });
  });

  it("accepts legacy session_id key", () => {
    const result = sessionCodec.deserialize({ session_id: "sess_legacy", cwd: "/tmp" });
    expect(result).toMatchObject({ sessionId: "sess_legacy", cwd: "/tmp" });
  });
});

describe("sessionCodec.serialize", () => {
  it("returns null for null input", () => {
    expect(sessionCodec.serialize(null)).toBeNull();
  });

  it("returns null when sessionId is missing", () => {
    expect(sessionCodec.serialize({ cwd: "/workspace" })).toBeNull();
  });

  it("round-trips sessionId + cwd", () => {
    const params = { sessionId: "sess_round", cwd: "/home/agent" };
    const serialized = sessionCodec.serialize(params);
    expect(serialized).toEqual({ sessionId: "sess_round", cwd: "/home/agent" });
    const deserialized = sessionCodec.deserialize(serialized);
    expect(deserialized).toEqual(params);
  });
});

describe("sessionCodec.getDisplayId", () => {
  const getDisplayId = sessionCodec.getDisplayId!;

  it("returns null for null input", () => {
    expect(getDisplayId(null)).toBeNull();
  });

  it("returns null when no sessionId present", () => {
    expect(getDisplayId({ cwd: "/tmp" })).toBeNull();
  });

  it("returns sessionId string", () => {
    expect(getDisplayId({ sessionId: "sess_display" })).toBe("sess_display");
  });
});
