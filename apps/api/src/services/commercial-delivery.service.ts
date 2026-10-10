import { createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,randomInt,timingSafeEqual } from "node:crypto";
import { CommercialDocumentError,object,id } from "./commercial-document.service.js";
export type DeliveryPolicy={version:string;linkMinutes:number;otpMinutes:number;maxAttempts:number;maxResends:number;resendSeconds:number;invoiceDueDays:number;invoiceIssuerUserId:string};
export function deliveryPolicy(value:unknown):DeliveryPolicy {
 const row=object(value,["version","linkMinutes","otpMinutes","maxAttempts","maxResends","resendSeconds","invoiceDueDays","invoiceIssuerUserId"]);
 const integer=(key:string,min:number,max:number)=>{const n=row[key];if(typeof n!=="number"||!Number.isInteger(n)||n<min||n>max)throw new CommercialDocumentError("COMMERCIAL_DELIVERY_POLICY_REQUIRED");return n;};
 return {version:id(row.version),linkMinutes:integer("linkMinutes",1,43200),otpMinutes:integer("otpMinutes",1,30),maxAttempts:integer("maxAttempts",1,10),maxResends:integer("maxResends",1,10),resendSeconds:integer("resendSeconds",30,3600),invoiceDueDays:integer("invoiceDueDays",0,365),invoiceIssuerUserId:id(row.invoiceIssuerUserId)};
}
function encryptionKey(){const value=process.env.COMMERCIAL_DELIVERY_KEY;if(!value||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new CommercialDocumentError("COMMERCIAL_DELIVERY_KEY_REQUIRED",503);const key=Buffer.from(value,"base64");if(key.length!==32)throw new CommercialDocumentError("COMMERCIAL_DELIVERY_KEY_REQUIRED",503);return key;}
export function encryptDelivery(value:unknown){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);return ["v1",iv.toString("base64"),cipher.getAuthTag().toString("base64"),data.toString("base64")].join(".");}
export function decryptDelivery(value:string){const [version,iv,tag,data,...rest]=value.split(".");if(version!=="v1"||rest.length||!iv||!tag||!data)throw new CommercialDocumentError("INVALID_DELIVERY_PAYLOAD",409);const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64"));decipher.setAuthTag(Buffer.from(tag,"base64"));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,"base64")),decipher.final()]).toString("utf8")) as {to:string;subject:string;text:string};}
export function randomLink(){return randomBytes(32).toString("base64url");}
export function tokenHash(token:unknown){if(typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new CommercialDocumentError("QUOTATION_LINK_UNAVAILABLE",404);return createHash("sha256").update(token).digest("hex");}
export function newOtp(){return String(randomInt(0,1000000)).padStart(6,"0");}
export function otpHash(accessId:string,version:number,action:string,code:string){return createHmac("sha256",encryptionKey()).update(JSON.stringify([accessId,version,action,code])).digest("hex");}
export function verifyOtpHash(expected:string,actual:string){if(!/^[0-9a-f]{64}$/.test(expected)||!/^[0-9a-f]{64}$/.test(actual))return false;return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(actual,"hex"));}
export function customerLink(token:string){const raw=process.env.COMMERCIAL_PUBLIC_URL;if(!raw)throw new CommercialDocumentError("COMMERCIAL_PUBLIC_URL_REQUIRED",503);const url=new URL(raw);if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw new CommercialDocumentError("INVALID_COMMERCIAL_PUBLIC_URL",503);url.pathname=url.pathname.replace(/\/$/,"")+"/quotation/"+token;return url.toString();}
/** Dedicated transport: never logs message bodies/tokens, even in development. */
export async function sendCommercialEmail(payload:{to:string;subject:string;text:string}) {
 const host=process.env.SMTP_HOST,user=process.env.SMTP_USER,pass=process.env.SMTP_PASS,from=process.env.SMTP_FROM;
 const port=Number(process.env.SMTP_PORT);if(!host||!user||!pass||!from||![465,587].includes(port))throw new CommercialDocumentError("COMMERCIAL_SMTP_REQUIRED",503);
 const {default:nodemailer}=await import("nodemailer");
 const transport=nodemailer.createTransport({host,port,secure:port===465,requireTLS:port===587,auth:{user,pass},tls:{rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
 try{const result=await transport.sendMail({...payload,from});if(result.rejected?.length||!result.accepted?.length)throw Error("rejected");}
 catch{throw new CommercialDocumentError("COMMERCIAL_DELIVERY_FAILED",503);}finally{transport.close();}
}
