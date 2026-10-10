import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireCommercialAccess } from "../middleware/requireCommercialAccess.js";
import { requireCommercialBillingAccess } from "../middleware/requireCommercialBillingAccess.js";
import { CommercialAccessError } from "../services/commercial-access.service.js";
import { CommercialDocumentError, id } from "../services/commercial-document.service.js";
import { CommercialValueError } from "../lib/commercial-money.js";
import { createQuotation, editQuotationDraft, getQuotation, listQuotations, requestQuotationApproval } from "../services/quotation.service.js";
import { getCommercialConfiguration,setCommercialConfiguration } from "../services/commercial-configuration.service.js";
import { sendQuotation,cancelQuotationDelivery } from "../services/quotation-customer.service.js";
import type { CommercialAction } from "../services/commercial-policy.js";

/** Deliberately unmounted until real HTTP/PostgreSQL authorization tests pass.
 * Must be mounted BEFORE legacy repair-capable billing/module middleware.
 */
export const quotationRouter: Router=Router();
quotationRouter.use(requireAuth);
const gate=(action:CommercialAction)=>[requireCommercialAccess("quotations",action),requireCommercialBillingAccess("quotations",action)];
function actor(req:AuthenticatedRequest) {
  const context=req.strictBusinessContext;
  if(!context||!req.user||context.userId!==req.user.id) throw new CommercialAccessError("Validated commercial context required");
  return {userId:context.userId,businessId:context.businessId};
}
function key(req:AuthenticatedRequest) {
  let count=0;
  for(let i=0;i<req.rawHeaders.length;i+=2) if(req.rawHeaders[i].toLowerCase()==="idempotency-key") count++;
  if(count!==1||typeof req.headers["idempotency-key"]!=="string") throw new CommercialDocumentError("SINGLE_IDEMPOTENCY_KEY_REQUIRED",400);
  return req.headers["idempotency-key"];
}
const handle=(work:(req:AuthenticatedRequest)=>Promise<unknown>,status=200)=>async(req:AuthenticatedRequest,res:Response)=>{
  try {return res.status(status).json({success:true,data:await work(req)});}
  catch(error) {
    if(error instanceof CommercialDocumentError) return res.status(error.status).json({success:false,code:error.code});
    if(error instanceof CommercialAccessError) return res.status(403).json({success:false,code:error.code});
    if(error instanceof CommercialValueError) return res.status(422).json({success:false,code:"INVALID_COMMERCIAL_VALUE"});
    return res.status(500).json({success:false,code:"COMMERCIAL_OPERATION_FAILED"});
  }
};
quotationRouter.get("/",...gate("quotation.read"),handle(req=>listQuotations(actor(req))));
quotationRouter.post("/",...gate("quotation.create"),handle(req=>createQuotation(actor(req),key(req),req.body),201));
quotationRouter.get("/configuration",...gate("commercial.policy.manage"),handle(req=>getCommercialConfiguration(actor(req))));
quotationRouter.patch("/configuration",...gate("commercial.policy.manage"),handle(req=>setCommercialConfiguration(actor(req),key(req),req.body)));
quotationRouter.get("/:id",...gate("quotation.read"),handle(req=>getQuotation(actor(req),id(req.params.id))));
quotationRouter.patch("/:id",...gate("quotation.update"),handle(req=>editQuotationDraft(actor(req),id(req.params.id),key(req),req.body)));
quotationRouter.post("/:id/revisions",...gate("quotation.update"),handle(req=>editQuotationDraft(actor(req),id(req.params.id),key(req),req.body,true),201));

quotationRouter.post("/:id/approval-request",...gate("quotation.update"),handle(req=>requestQuotationApproval(actor(req),id(req.params.id),key(req),req.body)));
quotationRouter.post("/:id/approve",...gate("quotation.approve"),handle(req=>requestQuotationApproval(actor(req),id(req.params.id),key(req),req.body,"approved")));
quotationRouter.post("/:id/reject-approval",...gate("quotation.approve"),handle(req=>requestQuotationApproval(actor(req),id(req.params.id),key(req),req.body,"rejected")));
quotationRouter.post("/:id/cancel-delivery",...gate("quotation.update"),handle(req=>cancelQuotationDelivery(actor(req),id(req.params.id),key(req),req.body)));
quotationRouter.post("/:id/send",...gate("quotation.send"),handle(req=>sendQuotation(actor(req),id(req.params.id),key(req),req.body)));
// A commercial-prefix miss must never fall through to legacy repair-capable gates.
quotationRouter.use((_req,res)=>res.status(404).json({success:false,code:"COMMERCIAL_ROUTE_NOT_FOUND"}));
