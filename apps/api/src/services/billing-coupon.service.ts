import { prisma } from "../lib/prisma.js";
import { toMoneyNumber } from "../lib/money.js";

export type CouponValidation = {
  ok: boolean;
  error?: string;
  couponId?: string;
  code?: string;
  discountType?: string;
  discountValue?: number;
  discountAmount?: number;
};

export async function validateCoupon(opts: {
  code: string;
  planCode: string;
  basePrice: number;
  businessId?: string;
}): Promise<CouponValidation> {
  const code = opts.code.trim().toUpperCase();
  if (!code) return { ok: false, error: "Coupon code required" };

  const coupon = await prisma.billingCoupon.findUnique({ where: { code } });
  if (!coupon || coupon.status !== "active") {
    return { ok: false, error: "Invalid coupon" };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: "Coupon expired" };
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    return { ok: false, error: "Coupon usage limit reached" };
  }
  const minAmt = coupon.minAmount != null ? toMoneyNumber(coupon.minAmount) : null;
  if (minAmt != null && opts.basePrice < minAmt) {
    return { ok: false, error: `Minimum amount ₹${minAmt}` };
  }
  const plans = coupon.applicablePlans as string[] | null;
  if (Array.isArray(plans) && plans.length && !plans.includes(opts.planCode)) {
    return { ok: false, error: "Coupon not valid for this plan" };
  }

  const discVal = toMoneyNumber(coupon.discountValue);
  let discountAmount = 0;
  if (coupon.discountType === "percent") {
    discountAmount = Math.round(opts.basePrice * (discVal / 100) * 100) / 100;
  } else {
    discountAmount = Math.min(opts.basePrice, discVal);
  }

  return {
    ok: true,
    couponId: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: discVal,
    discountAmount,
  };
}

export async function recordCouponRedemption(opts: {
  couponId: string;
  businessId: string;
  paymentId: string;
  userId?: string | null;
}) {
  await prisma.$transaction([
    prisma.couponRedemption.create({
      data: {
        couponId: opts.couponId,
        businessId: opts.businessId,
        paymentId: opts.paymentId,
        userId: opts.userId || null,
      },
    }),
    prisma.billingCoupon.update({
      where: { id: opts.couponId },
      data: { usedCount: { increment: 1 } },
    }),
  ]);
}
