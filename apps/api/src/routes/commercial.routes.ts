import type { Express } from "express";
import { quotationRouter } from "./quotation.routes.js";
import { commercialFinanceRouter } from "./commercial-finance.routes.js";
import { quotationCustomerRouter } from "./quotation-customer.routes.js";

/** Mount before legacy billing/module resolvers. Each router terminates misses;
 * private routes authenticate, validate/pin one tenant and use read-only billing.
 * Customer routes use only hashed links and decision-bound email OTP challenges.
 */
export function mountCommercialRoutes(app: Express): void {
  app.use("/api/quotations", quotationRouter);
  app.use("/api/commercial", commercialFinanceRouter);
  app.use("/api/quotation-customer", quotationCustomerRouter);
}
