import assert from "node:assert/strict";
import test from "node:test";
import {
  betLengthMinutes,
  ballotFromJson,
  disputeWindowSeconds,
  eligibleVoterIds,
  parseBallot,
  settleDecision,
  strictMajority,
} from "../src/rules.ts";

const now = new Date("2026-06-01T00:00:00.000Z");
const later = new Date("2026-06-02T00:00:00.000Z");
const earlier = new Date("2026-05-31T00:00:00.000Z");

test("bet length accepts minutes or hours inside the window", () => {
  assert.deepEqual(betLengthMinutes({ periodMinutes: 5 }), { minutes: 5 });
  assert.deepEqual(betLengthMinutes({ periodHours: 24 * 7 }), { minutes: 24 * 7 * 60 });
  assert.deepEqual(betLengthMinutes({ periodMinutes: 90 * 24 * 60 }), { minutes: 90 * 24 * 60 });
  assert.equal("error" in betLengthMinutes({ periodMinutes: 4 }), true);
  assert.equal("error" in betLengthMinutes({ periodHours: 24 * 91 }), true);
  assert.equal("error" in betLengthMinutes({}), true);
  assert.equal("error" in betLengthMinutes({ periodHours: 1, periodMinutes: 60 }), true);
});

test("dispute window defaults to a day and caps at seven", () => {
  assert.deepEqual(disputeWindowSeconds(undefined), { seconds: 24 * 60 * 60 });
  assert.deepEqual(disputeWindowSeconds(5), { seconds: 300 });
  assert.equal("error" in disputeWindowSeconds(4), true);
  assert.equal("error" in disputeWindowSeconds(7 * 24 * 60 + 1), true);
});

test("voters are judges, or the other circle members when no judges are set", () => {
  assert.deepEqual(eligibleVoterIds(["a", "b"], ["c"], ["a", "b", "c", "d"]), ["c"]);
  assert.deepEqual(eligibleVoterIds(["a", "b"], [], ["a", "b", "c", "d"]), ["c", "d"]);
});

test("a ballot has to cover every participant once", () => {
  assert.deepEqual(parseBallot(["a", "b"], [{ userId: "b", outcome: "fail" }, { userId: "a", outcome: "success" }]), {
    a: "success",
    b: "fail",
  });
  assert.equal(parseBallot(["a", "b"], [{ userId: "a", outcome: "success" }]), null);
  assert.equal(
    parseBallot(["a", "b"], [
      { userId: "a", outcome: "success" },
      { userId: "a", outcome: "fail" },
    ]),
    null,
  );
  assert.deepEqual(ballotFromJson([{ userId: "a", outcome: "success" }]), { a: "success" });
});

test("strict majority follows the eligible count, not the number of ballots cast", () => {
  const ids = ["a", "b"];
  const left = { a: "fail" as const, b: "success" as const };
  const right = { a: "success" as const, b: "fail" as const };
  assert.equal(strictMajority(1, [right], ids)?.a, "success");
  assert.equal(strictMajority(3, [left], ids), null);
  assert.equal(strictMajority(3, [left, left, right], ids)?.a, "fail");
  assert.equal(strictMajority(3, [left, right], ids), null);
  assert.equal(strictMajority(0, [], ids), null);
});

test("settlement upholds, overturns, voids, or leaves the window open", () => {
  const ids = ["a", "b"];
  const reporter = { a: "success" as const, b: "fail" as const };
  const flipped = { a: "fail" as const, b: "success" as const };
  assert.equal(
    settleDecision({
      status: "resolved",
      deadline: later,
      now,
      forceClose: false,
      participantIds: ids,
      reporter,
      eligibleCount: 1,
      ballots: [],
    }).action,
    "none",
  );
  assert.deepEqual(
    settleDecision({
      status: "resolved",
      deadline: earlier,
      now,
      forceClose: false,
      participantIds: ids,
      reporter,
      eligibleCount: 1,
      ballots: [],
    }),
    { action: "final", resolution: "unchallenged", replace: null },
  );
  assert.deepEqual(
    settleDecision({
      status: "disputed",
      deadline: later,
      now,
      forceClose: false,
      participantIds: ids,
      reporter,
      eligibleCount: 1,
      ballots: [reporter],
    }),
    { action: "final", resolution: "upheld", replace: null },
  );
  const overturned = settleDecision({
    status: "disputed",
    deadline: later,
    now,
    forceClose: false,
    participantIds: ids,
    reporter,
    eligibleCount: 1,
    ballots: [flipped],
  });
  assert.equal(overturned.action, "final");
  if (overturned.action === "final" && overturned.resolution === "overturned") {
    assert.equal(overturned.replace.a, "fail");
  } else {
    assert.fail("expected an overturn");
  }
  assert.deepEqual(
    settleDecision({
      status: "disputed",
      deadline: later,
      now,
      forceClose: true,
      participantIds: ids,
      reporter,
      eligibleCount: 3,
      ballots: [flipped],
    }),
    { action: "final", resolution: "void" },
  );
});
