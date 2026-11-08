// Razorpay Sandbox & Payment Guard Integration Test Suite
// Verifies rate-card calculations, exact paise conversion, capture matching,
// duplicate protection, and webhook HMAC signature integrity.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("node:crypto");
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
      throw new Error("offline guard modules must stay free of runtime dependencies");
    },
  });
  return exports;
}

const pricing = load(path.resolve(__dirname, "../src/services/saas-pricing.ts"));
const razorpayAmount = load(path.resolve(__dirname, "../src/services/razorpay-amount.ts"));

test("Starter monthly 3 users fresh checkout generates exact 3646200 paise with setup fee and 18% GST", () => {
  const quote = pricing.quoteSaasCharge({
    planCode: "starter_monthly",
    purpose: "checkout",
    userCount: 3,
    setupFeePaid: false,
  });

  // Base: 3 users * 300 = 900
  assert.equal(quote.unitPrice, 300);
  assert.equal(quote.subscriptionBase, 900);
  // Setup fee: 30000
  assert.equal(quote.setupFee, 30000);
  // Taxable: 30900
  assert.equal(quote.taxable, 30900);
  // GST 18%: 5562
  assert.equal(quote.gst, 5562);
  // Total: 36462
  assert.equal(quote.total, 36462);

  // Exact paise for Razorpay order
  const paise = razorpayAmount.orderAmountPaise(quote.total);
  assert.equal(paise, 3646200);
});

test("Professional monthly 10 users fresh checkout generates exact 4248000 paise with setup fee and 18% GST", () => {
  const quote = pricing.quoteSaasCharge({
    planCode: "professional_monthly",
    purpose: "checkout",
    userCount: 10,
    setupFeePaid: false,
  });

  // Base: 10 users * 600 = 6000
  assert.equal(quote.unitPrice, 600);
  assert.equal(quote.subscriptionBase, 6000);
  // Setup fee: 30000
  assert.equal(quote.setupFee, 30000);
  // Taxable: 36000
  assert.equal(quote.taxable, 36000);
  // GST 18%: 6480
  assert.equal(quote.gst, 6480);
  // Total: 42480
  assert.equal(quote.total, 42480);

  const paise = razorpayAmount.orderAmountPaise(quote.total);
  assert.equal(paise, 4248000);
});

test("Renewal for existing subscription skips setup fee and generates exact monthly subscription amount", () => {
  const quote = pricing.quoteSaasCharge({
    planCode: "starter_monthly",
    purpose: "renewal",
    userCount: 3,
    setupFeePaid: true,
    existingPaidSubscription: true,
    paidContract: {
      pricingVersion: pricing.SAAS_PRICING_VERSION,
      renewalBase: 900,
      userCount: 3,
      planCode: "starter_monthly",
    },
  });

  assert.equal(quote.subscriptionBase, 900);
  assert.equal(quote.setupFee, 0);
  assert.equal(quote.taxable, 900);
  assert.equal(quote.gst, 162);
  assert.equal(quote.total, 1062);

  const paise = razorpayAmount.orderAmountPaise(quote.total);
  assert.equal(paise, 106200);
});

test("Webhook capture verification approves exact paise match and activates", () => {
  const expectedPaise = 3646200;
  const capturedPaise = 3646200;

  const comparison = razorpayAmount.compareCapturedAmount(expectedPaise, capturedPaise);
  assert.equal(comparison, "match");

  const decision = razorpayAmount.decideCapturedActivation({
    eventAlreadyProcessed: false,
    paymentFound: true,
    paymentStatus: "created",
    activated: false,
    comparison,
  });

  assert.equal(decision.activate, true);
  assert.equal(decision.duplicate, false);
});

test("Webhook capture verification rejects underpaid amount and fails closed", () => {
  const expectedPaise = 3646200;
  const capturedPaise = 90000; // underpaid

  const comparison = razorpayAmount.compareCapturedAmount(expectedPaise, capturedPaise);
  assert.equal(comparison, "underpayment");

  const decision = razorpayAmount.decideCapturedActivation({
    eventAlreadyProcessed: false,
    paymentFound: true,
    paymentStatus: "created",
    activated: false,
    comparison,
  });

  assert.equal(decision.activate, false);
  assert.equal(decision.reason, "underpayment");
});

test("Webhook capture verification rejects duplicate event for already activated payment", () => {
  const expectedPaise = 3646200;
  const capturedPaise = 3646200;

  const comparison = razorpayAmount.compareCapturedAmount(expectedPaise, capturedPaise);
  const decision = razorpayAmount.decideCapturedActivation({
    eventAlreadyProcessed: false,
    paymentFound: true,
    paymentStatus: "paid",
    activated: true,
    comparison,
  });

  assert.equal(decision.activate, false);
  assert.equal(decision.duplicate, true);
  assert.equal(decision.reason, "already_activated");
});

test("Webhook HMAC signature validation accepts genuine signature and rejects forged payload", () => {
  const secret = "whsec_test_secret_massive_mentor_2026";
  const rawBody = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_test_1234567890",
          amount: 3646200,
          currency: "INR",
          status: "captured",
        },
      },
    },
  });

  const validSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  function verify(body, sig, sec) {
    if (!body || !sig || !sec) return false;
    const expected = crypto.createHmac("sha256", sec).update(body).digest("hex");
    if (expected.length !== sig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  }

  assert.equal(verify(rawBody, validSignature, secret), true);
  assert.equal(verify(rawBody, "invalid_signature_hex_1234567890abcdef1234567890abcdef1234567890abcdef", secret), false);
  assert.equal(verify(rawBody + "tampered", validSignature, secret), false);
});
