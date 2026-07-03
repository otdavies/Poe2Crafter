/** Share-link codec: a real crafted session must survive the URL roundtrip. */
import { describe, expect, it } from "vitest";
import { actionFor } from "../engine/actions.ts";
import { createItem } from "../engine/item.ts";
import { seededRng } from "../engine/rng.ts";
import { findBase, loadEngineData } from "../engine/testutil.ts";
import { decodeSession, encodedFromHash, encodeSession, sessionHash } from "./share.ts";
import type { Session } from "./store.ts";

const data = loadEngineData();

function craftedSession(): Session {
  const rng = seededRng(11);
  const initial = createItem(data, findBase(data, "Amulet"), 82, rng);
  const session: Session = { initial, steps: [] };
  let item = initial;
  for (const currencyId of ["transmute", "aug", "regal", "exalted"]) {
    const action = actionFor(data, currencyId)!;
    expect(action.canApply(data, item, new Set())).toBeNull();
    const result = action.apply(data, item, rng, new Set());
    session.steps.push({ currencyId, omens: [], events: result.events, after: result.item });
    item = result.item;
  }
  return session;
}

describe("share links", () => {
  it("roundtrips a crafted session through the URL hash", () => {
    const session = craftedSession();
    const hash = sessionHash(session);
    expect(hash.startsWith("#c=")).toBe(true);
    const encoded = encodedFromHash(hash);
    expect(encoded).toBeDefined();
    expect(decodeSession(data, encoded!)).toEqual(session);
  });

  it("rejects garbage, wrong versions, and unknown ids", () => {
    expect(decodeSession(data, "not-a-real-payload")).toBeUndefined();
    expect(encodedFromHash("#other=x")).toBeUndefined();
    expect(encodedFromHash("")).toBeUndefined();

    const session = craftedSession();
    const tampered = JSON.parse(JSON.stringify(session)) as Session;
    tampered.initial.baseId = "Metadata/DoesNotExist";
    expect(decodeSession(data, encodeSession(tampered))).toBeUndefined();

    const badMod = JSON.parse(JSON.stringify(session)) as Session;
    badMod.steps[3].after.explicits[0].modId = "NotARealMod";
    expect(decodeSession(data, encodeSession(badMod))).toBeUndefined();
  });
});
