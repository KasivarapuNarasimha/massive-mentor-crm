import {Router,type Request,type Response} from "express";
import rateLimit from "express-rate-limit";
import {viewCustomerQuotation,requestCustomerOtp,verifyCustomerDecision} from "../services/quotation-customer.service.js";
import {CommercialDocumentError,object} from "../services/commercial-document.service.js";
export const quotationCustomerRouter:Router=Router();
quotationCustomerRouter.use((_req,res,next)=>{res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff"});next();});
// Additional IP abuse ceiling; persisted per-link policy controls OTP retries/resends.
quotationCustomerRouter.use(rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false,message:{success:false,code:"CUSTOMER_RATE_LIMIT"}}));
const handle=(work:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{return res.json({success:true,data:await work(req)});}catch(e){return res.status(e instanceof CommercialDocumentError?e.status:403).json({success:false,code:e instanceof CommercialDocumentError?e.code:"QUOTATION_UNAVAILABLE"});}};
quotationCustomerRouter.post("/view",handle(req=>viewCustomerQuotation(object(req.body,["token"]).token)));
quotationCustomerRouter.post("/otp",handle(req=>{const row=object(req.body,["token","action"]);return requestCustomerOtp(row.token,{action:row.action});}));
quotationCustomerRouter.post("/decision",handle(req=>{const row=object(req.body,["token","action","code"]);return verifyCustomerDecision(row.token,{action:row.action,code:row.code});}));
quotationCustomerRouter.use((_req,res)=>res.status(404).json({success:false,code:"QUOTATION_UNAVAILABLE"}));
