# Phase B approved pure pricing contract

`calculateCommercialQuote(input, currencies)` is additive and unmounted. Existing
`calculateCommercialLine` and `calculateCommercialTotals` are unchanged.
The currency allowlist is trusted caller configuration; only explicitly configured
two-decimal currencies are accepted. No default currency or business threshold exists.

Policy version: `stacked-exclusive-v1`. Inputs are canonical decimal strings;
money supports two decimals, quantities and rates four. Quantities must be positive.
Fixed line discounts apply to the whole line, not each unit. Percentage is 0–100.
Missing discounts mean zero; tax rate must always be explicit, including "0".

Order: round quantity × price half-up to cents; round/subtract line percentage;
subtract line fixed; round quotation percentage on the remaining subtotal and
allocate it; allocate quotation fixed against the new remaining line bases.
Both quotation allocations use proportional integer-cent largest remainders,
with immutable unique integer position resolving ties, regardless of array order.
Zero-base lines receive no allocation. Discounts exceeding the remaining base fail.
Then calculate tax-exclusive tax per remaining line, round half-up to cents and
sum rounded line results. Storage overflow fails at monetary stages/totals.
No shipping, surcharges, signed adjustments, database access or authorization.

Outputs are decimal strings with the version, original subtotal, discount stages,
line allocations, taxable bases, taxes and totals. The effective percentage is a
four-decimal half-up DISPLAY value. Its exact ratio uses total-discount cents as
numerator and original-subtotal cents as denominator. A future policy evaluator
must compare by exact cross multiplication, never the rounded display percentage:
approval requires strictly greater than a configured threshold, not equality.
An optional currency-amount threshold compares exact discount cents separately.
Neither threshold is configured or evaluated in this arithmetic engine.
Zero subtotal returns null percentage/ratio; policy must explicitly decide how
to handle it. Zero totals are permitted here, not automatic approval/acceptance.

Regression: original 300.00; line discounts 20.00 + 10.00; quotation percentage
27.00; quotation fixed 24.30; taxable base 218.70; tax 24.79; total 243.49.

Offline command:
`node --test apps/api/scripts/commercial-pricing.test.cjs apps/api/scripts/commercial-foundation.test.cjs apps/api/scripts/strict-business-resolution.test.cjs`

No quotation schema/routes, invoice conversion or payment behavior is implemented.
PostgreSQL concurrency remains unverified and is unrelated to these pure tests.
