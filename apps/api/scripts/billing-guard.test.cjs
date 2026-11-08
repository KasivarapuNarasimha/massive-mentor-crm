// Offline checks for scheduled downgrades and Razorpay amount guards.
// No database and no Razorpay calls.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const req = createRequire(path.resolve(__dirname, "../package.json"));
const ts = req("typescript");

function load(file) {
  const exports = {};
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    require() {
      throw new Error("guard modules must stay free of runtime dependencies");
    },
  });
  return exports;
}

const schedule = load(path.resolve(__dirname, "../src/services/billing-schedule.ts"));
const amounts = load(path.resolve(__dirname, "../src/services/razorpay-amount.ts"));

const effectiveAt = "2026-12-01T00:00:00.000Z";
const before = new Date("2026-11-30T23:59:59.999Z");
const onDate = new Date(effectiveAt);
const after = new Date("2026-12-02T00:00:00.000Z");

function dueSettings(extra = {}) {
  return {
    theme: "kept",
    ...schedule.scheduledPlanSettings({
      planCode: "starter_monthly",
      effectiveAt,
      paymentId: "pay-row",
      subscriptionId: "sub-row",
    }),
    ...extra,
  };
}

test("scheduled downgrade does nothing before the effective date", () => {
  const decision = schedule.evaluateScheduledPlan({
    settings: dueSettings(),
    now: before,
    planFound: true,
    subscriptionFound: true,
  });
  assert.equal(decision.outcome, "skip");
  assert.equal(decision.reason, "before_effective_date");
});

test("scheduled downgrade applies on the effective date", () => {
  const decision = schedule.evaluateScheduledPlan({
    settings: dueSettings(),
    now: onDate,
    planFound: true,
    subscriptionFound: true,
  });
  assert.equal(decision.outcome, "apply");
  assert.equal(decision.intent.planCode, "starter_monthly");
  assert.equal(decision.intent.paymentId, "pay-row");
  assert.equal(decision.intent.subscriptionId, "sub-row");
});

test("scheduled downgrade applies after the effective date", () => {
  const decision = schedule.evaluateScheduledPlan({
    settings: dueSettings(),
    now: after,
    planFound: true,
    subscriptionFound: true,
  });
  assert.equal(decision.outcome, "apply");
  assert.equal(decision.appliedKey, "starter_monthly@2026-12-01T00:00:00.000Z");
});

test("scheduled downgrade applies once and a second run does nothing", () => {
  const first = schedule.evaluateScheduledPlan({
    settings: dueSettings(),
    now: onDate,
    planFound: true,
    subscriptionFound: true,
  });
  assert.equal(first.outcome, "apply");
  const next = schedule.settingsAfterApply(dueSettings(), {
    planCode: "starter_monthly",
    effectiveAt,
    appliedAt: onDate.toISOString(),
  });
  assert.equal(next.theme, "kept");
  assert.equal(next.scheduledPlanCode, undefined);
  assert.equal(next.scheduledPlanAppliedCode, "starter_monthly");
  assert.equal("setupFeePaid" in next, false);
  const second = schedule.evaluateScheduledPlan({
    settings: next,
    now: after,
    planFound: true,
    subscriptionFound: true,
  });
  assert.equal(second.outcome, "skip");
  assert.equal(second.reason, "already_applied");
  const patch = schedule.entitlementPatch({
    planCode: "starter_monthly",
    planId: "plan-1",
    maxUsers: 3,
    subscriptionEndsAt: after,
  });
  assert.equal(patch.plan, "starter");
  assert.equal(patch.maxUsers, 3);
  assert.equal("setupFeePaid" in patch, false);
  assert.equal(schedule.seatCapFromPayment({ pricingVersion: "2026-per-user", userCount: 4 }, 3), 4);
  assert.equal(schedule.seatCapFromPayment({ basePrice: 1499 }, 3), 3);
});

test("scheduled downgrade failure does not produce an entitlement change", () => {
  const missingPlan = schedule.evaluateScheduledPlan({
    settings: dueSettings(),
    now: after,
    planFound: false,
    subscriptionFound: true,
  });
  assert.equal(missingPlan.outcome, "fail");
  assert.equal(missingPlan.reason, "plan_not_found");
  const missingSub = schedule.evaluateScheduledPlan({
    settings: dueSettings(),
    now: after,
    planFound: true,
    subscriptionFound: false,
  });
  assert.equal(missingSub.outcome, "fail");
  assert.equal(missingSub.reason, "subscription_not_found");
  const badDate = schedule.evaluateScheduledPlan({
    settings: dueSettings({ scheduledPlanAt: "not-a-date" }),
    now: after,
    planFound: true,
    subscriptionFound: true,
  });
  assert.equal(badDate.outcome, "fail");
  assert.equal(badDate.reason, "invalid_effective_date");
  const service = fs.readFileSync(
    path.resolve(__dirname, "../src/services/billing-schedule.service.ts"),
    "utf8"
  );
  assert.equal(service.includes("billingPayment.update"), false);
  assert.equal(service.includes("billingPayment.create"), false);
  assert.equal(service.includes("subscription.update"), false);
  assert.equal(service.includes("subscription.create"), false);
  assert.equal(service.includes("platformInvoice"), false);
  assert.equal(service.includes("setupFeePaid:"), false);
});

test("captured paise must match before activation", () => {
  const expected = amounts.orderAmountPaise(955.8);
  assert.equal(expected, 95580);
  assert.equal(amounts.expectedAmountPaise(955.8, { expectedAmountPaise: expected }), expected);
  assert.equal(amounts.compareCapturedAmount(expected, 95580), "match");
  assert.equal(amounts.compareCapturedAmount(expected, 95579), "underpayment");
  assert.equal(amounts.compareCapturedAmount(expected, 95581), "overpayment");
  assert.equal(amounts.compareCapturedAmount(expected, null), "invalid");
  assert.equal(amounts.readCapturedPaise({ amount: 95580 }), 95580);
  assert.equal(amounts.orderAmountPaise(0.4), 100);

  const match = amounts.decideCapturedActivation({
    eventAlreadyProcessed: false,
    paymentFound: true,
    paymentStatus: "created",
    activated: false,
    comparison: "match",
  });
  assert.equal(match.activate, true);
  assert.equal(match.duplicate, false);

  for (const comparison of ["underpayment", "overpayment", "invalid"]) {
    const rejected = amounts.decideCapturedActivation({
      eventAlreadyProcessed: false,
      paymentFound: true,
      paymentStatus: "authorized",
      activated: false,
      comparison,
    });
    assert.equal(rejected.activate, false, comparison);
    assert.equal(rejected.duplicate, false, comparison);
    assert.equal(rejected.reason, comparison);
  }
});

test("duplicate webhook does not activate again", () => {
  const processed = amounts.decideCapturedActivation({
    eventAlreadyProcessed: true,
    paymentFound: true,
    paymentStatus: "created",
    activated: false,
    comparison: "match",
  });
  assert.equal(processed.activate, false);
  assert.equal(processed.duplicate, true);
  assert.equal(processed.reason, "already_processed");

  const activated = amounts.decideCapturedActivation({
    eventAlreadyProcessed: false,
    paymentFound: true,
    paymentStatus: "paid",
    activated: true,
    comparison: "underpayment",
  });
  assert.equal(activated.activate, false);
  assert.equal(activated.duplicate, true);
  assert.equal(activated.reason, "already_activated");
});

test("webhook and client acknowledgement check the amount before activation", () => {
  const webhook = fs.readFileSync(
    path.resolve(__dirname, "../src/services/billing-webhook.service.ts"),
    "utf8"
  );
  const captureAt = webhook.indexOf('eventType === "payment.captured"');
  const capture = webhook.slice(captureAt);
  const decideAt = capture.indexOf("decideCapturedActivation");
  const activateAt = capture.indexOf("activateSubscriptionFromPayment");
  assert.ok(decideAt > 0);
  assert.ok(activateAt > decideAt);
  assert.match(webhook, /if \(existing\?\.processed\)/);

  const billing = fs.readFileSync(
    path.resolve(__dirname, "../src/services/saas-billing.service.ts"),
    "utf8"
  );
  const ackAt = billing.indexOf("export async function acknowledgeCheckoutPayment");
  const ack = billing.slice(ackAt, billing.indexOf("export async function getPaymentStatus"));
  assert.ok(ack.indexOf("decideCapturedActivation") < ack.indexOf("activateSubscriptionFromPayment"));
  assert.match(ack, /Payment amount does not match the order/);
  assert.match(billing, /expectedAmountPaise: amountPaise/);
  assert.match(billing, /export async function previewCheckout/);
});

test("legacy activation still marks setup paid and does not rewrite stored rows", () => {
  const activation = fs.readFileSync(
    path.resolve(__dirname, "../src/services/billing-activation.service.ts"),
    "utf8"
  );
  assert.match(activation, /perUserPurchase \? biz\.setupFeePaid \|\| setupCharged : true/);
  assert.match(activation, /does not rewrite existing businesses/);
  assert.match(activation, /scheduledPlanSettings\(/);
  const job = fs.readFileSync(
    path.resolve(__dirname, "../src/services/saas-billing.service.ts"),
    "utf8"
  );
  assert.match(job, /applyDueScheduledPlanChanges\(now\)/);
});

test("confirmation modal asks the server for the payable amount", () => {
  const page = fs.readFileSync(
    path.resolve(__dirname, "../../web/app/dashboard/billing/page.tsx"),
    "utf8"
  );
  assert.match(page, /\/billing\/checkout\/preview/);
  assert.match(page, /shownAmountPaise/);
  assert.match(page, /Final payable/);
  assert.equal(page.includes("requestSubscribe"), false);
  assert.equal(page.includes("Math.round(base * 0.18"), false);
});
