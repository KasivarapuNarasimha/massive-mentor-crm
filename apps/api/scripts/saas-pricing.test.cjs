// Offline quotes for the 2026 per-user rate card. No database and no Razorpay.
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
      throw new Error("saas-pricing must stay free of runtime dependencies");
    },
  });
  return exports;
}

const pricing = load(path.resolve(__dirname, "../src/services/saas-pricing.ts"));
const { quoteSaasCharge, invoiceLinesFromMetadata, monthlyRecurringAmount } = pricing;

function quote(planCode, userCount, extra = {}) {
  return quoteSaasCharge({
    planCode,
    userCount,
    purpose: "checkout",
    setupFeePaid: true,
    ...extra,
  });
}

test("starter 3 users per month is 900 plus 18 percent GST", () => {
  const q = quote("starter_monthly", 3);
  assert.equal(q.subscriptionBase, 900);
  assert.equal(q.setupFee, 0);
  assert.equal(q.gst, 162);
  assert.equal(q.total, 1062);
  assert.equal(q.unitPrice, 300);
  assert.equal(q.userCount, 3);
});

test("professional 10 users per month is 6000 plus 18 percent GST", () => {
  const q = quote("professional_monthly", 10);
  assert.equal(q.subscriptionBase, 6000);
  assert.equal(q.gst, 1080);
  assert.equal(q.total, 7080);
  assert.equal(q.unitPrice, 600);
});

test("starter 3 users per year is 12 times monthly with no extra discount", () => {
  const q = quote("starter_annual", 3);
  assert.equal(q.unitPrice, 3600);
  assert.equal(q.subscriptionBase, 10800);
  assert.equal(q.gst, 1944);
  assert.equal(q.total, 12744);
  assert.notEqual(q.unitPrice, Math.round(300 * 12 * 0.9));
});

test("professional 10 users per year is 72000 plus 18 percent GST", () => {
  const q = quote("professional_annual", 10);
  assert.equal(q.unitPrice, 7200);
  assert.equal(q.subscriptionBase, 72000);
  assert.equal(q.gst, 12960);
  assert.equal(q.total, 84960);
  assert.notEqual(q.unitPrice, 6480);
});

test("setup fee is 30000 plus GST and is added once on a new checkout", () => {
  const q = quoteSaasCharge({
    planCode: "starter_monthly",
    userCount: 3,
    purpose: "checkout",
    setupFeePaid: false,
  });
  assert.equal(q.subscriptionBase, 900);
  assert.equal(q.setupFee, 30000);
  assert.equal(q.lines[1].description.includes("setup"), true);
  assert.equal(q.lines[1].amount, 30000);
  assert.equal(Math.round(30000 * 0.18 * 100) / 100, 5400);
  assert.equal(q.taxable, 30900);
  assert.equal(q.gst, 5562);
  assert.equal(q.total, 36462);
});

test("a paid setup flag keeps the next checkout free of setup", () => {
  const q = quote("professional_monthly", 10, { setupFeePaid: true, purpose: "checkout" });
  assert.equal(q.setupFee, 0);
  assert.equal(q.lines.length, 1);
});

test("legacy renewal keeps the stored price and never adds setup", () => {
  const contract = { pricingVersion: null, planCode: "starter_monthly", basePrice: 1499, userCount: null };
  const q = quoteSaasCharge({
    planCode: "starter_monthly",
    purpose: "renewal",
    userCount: 3,
    setupFeePaid: false,
    paidContract: contract,
  });
  assert.equal(q.pricingVersion, "legacy");
  assert.equal(q.subscriptionBase, 1499);
  assert.equal(q.setupFee, 0);
  assert.notEqual(q.subscriptionBase, 900);
  assert.equal(contract.basePrice, 1499);
});

test("legacy annual renewal does not apply the old 10 percent discount again", () => {
  const q = quoteSaasCharge({
    planCode: "professional_annual",
    purpose: "renewal",
    setupFeePaid: false,
    paidContract: { basePrice: 75589, planCode: "professional_annual" },
  });
  assert.equal(q.subscriptionBase, 75589);
  assert.equal(q.setupFee, 0);
});

test("per-user renewal repeats the contracted seats and omits setup", () => {
  const q = quoteSaasCharge({
    planCode: "starter_annual",
    purpose: "renewal",
    userCount: 10,
    setupFeePaid: false,
    paidContract: {
      pricingVersion: "2026-per-user",
      planCode: "starter_annual",
      subscriptionBase: 10800,
      userCount: 3,
    },
  });
  assert.equal(q.pricingVersion, "2026-per-user");
  assert.equal(q.userCount, 3);
  assert.equal(q.subscriptionBase, 10800);
  assert.equal(q.setupFee, 0);
  assert.equal(q.gst, 1944);
});

test("seat quantity changes the new subscription and not a legacy renewal", () => {
  assert.equal(quote("starter_monthly", 1).subscriptionBase, 300);
  assert.equal(quote("professional_monthly", 2).subscriptionBase, 1200);
  const legacy = quoteSaasCharge({
    planCode: "professional_monthly",
    purpose: "renewal",
    userCount: 10,
    setupFeePaid: true,
    paidContract: { basePrice: 6999 },
  });
  assert.equal(legacy.subscriptionBase, 6999);
});

test("setup is not discounted and historical invoice lines stay untouched", () => {
  const q = quoteSaasCharge({
    planCode: "starter_monthly",
    userCount: 3,
    purpose: "checkout",
    setupFeePaid: false,
    discountAmount: 900,
  });
  assert.equal(q.subscriptionBase, 900);
  assert.equal(q.setupFee, 30000);
  assert.equal(q.taxable, 30000);
  assert.equal(q.gst, 5400);
  const old = invoiceLinesFromMetadata(
    { planCode: "starter_monthly", basePrice: 1499 },
    { description: "Starter Monthly", amount: 1768.82 }
  );
  assert.equal(old.length, 1);
  assert.equal(old[0].amount, 1768.82);
  assert.equal(JSON.stringify(old).includes("30000"), false);
});

test("MRR keeps the frozen plan price unless the payment is per-user", () => {
  assert.equal(monthlyRecurringAmount({ billingCycle: "monthly", planPrice: 1499, metadata: { basePrice: 1499 } }), 1499);
  assert.equal(monthlyRecurringAmount({ billingCycle: "annual", planPrice: 16189, metadata: null }), Math.round((16189 / 12) * 100) / 100);
  assert.equal(
    monthlyRecurringAmount({
      billingCycle: "monthly",
      planPrice: 1499,
      metadata: { pricingVersion: "2026-per-user", subscriptionBase: 900 },
    }),
    900
  );
});

test("a renewal without a subscription cannot skip the setup fee", () => {
  assert.throws(
    () =>
      quoteSaasCharge({
        planCode: "starter_monthly",
        purpose: "renewal",
        userCount: 3,
        setupFeePaid: false,
      }),
    /existing subscription/i
  );
  const kept = quoteSaasCharge({
    planCode: "starter_monthly",
    purpose: "renewal",
    setupFeePaid: false,
    existingPaidSubscription: true,
  });
  assert.equal(kept.subscriptionBase, 1499);
  assert.equal(kept.setupFee, 0);
});

test("enterprise checkout is rejected", () => {
  assert.throws(() => quote("enterprise_monthly", 10), /custom/i);
});

test("coupon discount and GST stay on paise and the Razorpay paise match the total", () => {
  const discount = Math.round(900 * (10 / 100) * 100) / 100;
  const q = quoteSaasCharge({
    planCode: "starter_monthly",
    userCount: 3,
    purpose: "checkout",
    setupFeePaid: true,
    discountAmount: discount,
  });
  assert.equal(q.discountAmount, 90);
  assert.equal(q.taxable, 810);
  assert.equal(q.gst, 145.8);
  assert.equal(q.total, 955.8);
  assert.equal(Math.round(q.total * 100), 95580);
  assert.equal(q.lines.reduce((sum, line) => sum + line.amount, 0) - q.discountAmount, q.taxable);
  const withSetup = quote("starter_monthly", 3, { setupFeePaid: false });
  assert.equal(Math.round(withSetup.total * 100), 3646200);
  assert.equal(withSetup.total, Math.round((withSetup.taxable + withSetup.gst) * 100) / 100);
});

test("downgrade still prices setup once, and a deferred activation records it", () => {
  const first = quoteSaasCharge({
    planCode: "starter_monthly",
    userCount: 3,
    purpose: "downgrade",
    setupFeePaid: false,
  });
  assert.equal(first.setupFee, 30000);
  const again = quoteSaasCharge({
    planCode: "starter_monthly",
    userCount: 3,
    purpose: "downgrade",
    setupFeePaid: true,
  });
  assert.equal(again.setupFee, 0);
  const activation = fs.readFileSync(
    path.resolve(__dirname, "../src/services/billing-activation.service.ts"),
    "utf8"
  );
  assert.match(activation, /perUserPurchase && setupCharged \? \{ setupFeePaid: true \}/);
});

test("catalog seed does not rewrite an existing plan price", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/services/subscription-plan.service.ts"), "utf8");
  assert.match(source, /if \(existing\) continue/);
  assert.equal(source.includes("update:"), false);
  const activation = fs.readFileSync(path.resolve(__dirname, "../src/services/billing-activation.service.ts"), "utf8");
  assert.match(activation, /perUserPurchase \? biz\.setupFeePaid \|\| setupCharged : true/);
  assert.match(activation, /perUserPurchase && Number\.isInteger\(purchasedUsers\)/);
});

test("web rate card matches the API and drops the annual discount", () => {
  const webPath = path.resolve(__dirname, "../../web/lib/plan-entitlements.ts");
  const web = fs.readFileSync(webPath, "utf8");
  assert.match(web, /starter: 300/);
  assert.match(web, /professional: 600/);
  assert.match(web, /SETUP_FEE_INR = 30000/);
  assert.match(web, /ANNUAL_MONTHS = 12/);
  assert.equal(web.includes("additionalUserAnnual"), false);
  assert.equal(web.includes("ANNUAL_DISCOUNT_PCT"), false);
  assert.equal(web.includes("3240"), false);
  assert.equal(web.includes("6480"), false);
  const display = load(webPath);
  const starterMonth = display.quotePlanDisplay({
    tier: "starter", cycle: "monthly", userCount: 3, setupFeePaid: true, purpose: "checkout",
  });
  const starterYear = display.quotePlanDisplay({
    tier: "starter", cycle: "annual", userCount: 3, setupFeePaid: true, purpose: "checkout",
  });
  const proMonth = display.quotePlanDisplay({
    tier: "professional", cycle: "monthly", userCount: 10, setupFeePaid: true, purpose: "checkout",
  });
  const proYear = display.quotePlanDisplay({
    tier: "professional", cycle: "annual", userCount: 10, setupFeePaid: true, purpose: "checkout",
  });
  assert.equal(starterMonth.unitPrice, 300);
  assert.equal(starterMonth.subscriptionBase, 900);
  assert.equal(starterYear.unitPrice, 3600);
  assert.equal(starterYear.subscriptionBase, 10800);
  assert.equal(proMonth.subscriptionBase, 6000);
  assert.equal(proYear.subscriptionBase, 72000);
  const renewal = display.quotePlanDisplay({
    tier: "starter", cycle: "monthly", userCount: 3, setupFeePaid: false, purpose: "renewal",
  });
  assert.equal(renewal.setupFee, 0);
});
