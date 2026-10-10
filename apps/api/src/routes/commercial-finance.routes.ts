import {Router,type Response} from "express";
import {requireAuth,type AuthenticatedRequest} from "../middleware/auth.js";
import {requireCommercialAccess} from "../middleware/requireCommercialAccess.js";
import {requireCommercialBillingAccess} from "../middleware/requireCommercialBillingAccess.js";
import {CommercialAccessError} from "../services/commercial-access.service.js";
import {CommercialDocumentError,id} from "../services/commercial-document.service.js";
import {CommercialValueError} from "../lib/commercial-money.js";
import {getCommercialInvoice,recordCommercialPayment,reverseCommercialPayment,commercialReport} from "../services/commercial-finance.service.js";
import type {CommercialAction} from "../services/commercial-policy.js";
export const commercialFinanceRouter:Router=Router();commercialFinanceRouter.use(requireAuth);
const gate=(action:CommercialAction)=>[requireCommercialAccess("finance",action),requireCommercialBillingAccess("finance",action)];
function actor(req:AuthenticatedRequest){if(!req.user||!req.strictBusinessContext||req.user.id!==req.strictBusinessContext.userId)throw new CommercialAccessError("Pinned context required");return {userId:req.user.id,businessId:req.strictBusinessContext.businessId};}
function key(req:AuthenticatedRequest){let count=0;for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i].toLowerCase()==="idempotency-key")count++;if(count!==1||typeof req.headers["idempotency-key"]!=="string")throw new CommercialDocumentError("SINGLE_IDEMPOTENCY_KEY_REQUIRED",400);return req.headers["idempotency-key"];}
const handle=(work:(req:AuthenticatedRequest)=>Promise<unknown>)=>async(req:AuthenticatedRequest,res:Response)=>{try{return res.json({success:true,data:await work(req)});}catch(e){const known=e instanceof CommercialDocumentError||e instanceof CommercialAccessError||e instanceof CommercialValueError;return res.status(e instanceof CommercialDocumentError?e.status:e instanceof CommercialAccessError?403:e instanceof CommercialValueError?422:500).json({success:false,code:known?(e instanceof CommercialValueError?"INVALID_COMMERCIAL_VALUE":e.code):"COMMERCIAL_OPERATION_FAILED"});}};
commercialFinanceRouter.get("/reports",...gate("invoice.read"),handle(req=>commercialReport(actor(req),req.query.cursor===undefined?undefined:id(req.query.cursor))));
commercialFinanceRouter.get("/invoices/:id",...gate("invoice.read"),handle(req=>getCommercialInvoice(actor(req),id(req.params.id))));
commercialFinanceRouter.post("/invoices/:id/payments",...gate("payment.record"),handle(req=>recordCommercialPayment(actor(req),id(req.params.id),key(req),req.body)));
commercialFinanceRouter.post("/invoices/:id/payments/:paymentId/reverse",...gate("payment.reverse"),handle(req=>reverseCommercialPayment(actor(req),id(req.params.id),id(req.params.paymentId),key(req),req.body)));
commercialFinanceRouter.use((_req,res)=>res.status(404).json({success:false,code:"COMMERCIAL_ROUTE_NOT_FOUND"}));
