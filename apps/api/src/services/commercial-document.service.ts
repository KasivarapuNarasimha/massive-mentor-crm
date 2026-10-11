import { isCurrencyCode } from "../lib/currency.js";
import { createHash } from "node:crypto";
import { parseCommercialDecimal } from "../lib/commercial-money.js";
import { calculateCommercialQuote, COMMERCIAL_PRICING_VERSION } from "./commercial-pricing.service.js";

export const COMMERCIAL_HASH_VERSION = "mm-commercial-content-v1";
export class CommercialDocumentError extends Error {
  constructor(readonly code: string, readonly status = 422) { super(code); }
}
export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) throw new CommercialDocumentError("INVALID_COMMERCIAL_DOCUMENT");
  return value as Record<string, unknown>;
}
export function text(value: unknown, maximum = 20000): string {
  if (typeof value !== "string" || value.length > maximum || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new CommercialDocumentError("INVALID_COMMERCIAL_TEXT");
  }
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}
export function id(value: unknown): string {
  const result = text(value, 128);
  if (!result || result.trim() !== result) throw new CommercialDocumentError("INVALID_COMMERCIAL_ID");
  return result;
}
/** Closed JSON contract: numbers/undefined/non-JSON values cannot enter content hashes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(text(value, 1000000));
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CommercialDocumentError("NON_CANONICAL_COMMERCIAL_CONTENT");
  }
  const row = value as Record<string, unknown>;
  const compare = (a:string,b:string):number => {
    const x=Array.from(a, c=>c.codePointAt(0)!), y=Array.from(b,c=>c.codePointAt(0)!);
    for(let i=0;i<Math.min(x.length,y.length);i++) if(x[i]!==y[i]) return x[i]-y[i];
    return x.length-y.length;
  };
  const keys=Object.keys(row).map(raw=>({raw,normalized:text(raw)}));
  if(new Set(keys.map(key=>key.normalized)).size!==keys.length) throw new CommercialDocumentError("CANONICAL_KEY_COLLISION");
  return "{" + keys.sort((a,b)=>compare(a.normalized,b.normalized)).map(key=>JSON.stringify(key.normalized)+":"+canonical(row[key.raw])).join(",") + "}";
}
export function contentHash(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
const money = (value: unknown) => parseCommercialDecimal(value, "money").toFixed(2);
const rate = (value: unknown) => {
  const d = parseCommercialDecimal(value, "taxRate");
  if (d.gt(100)) throw new CommercialDocumentError("INVALID_DISCOUNT_RATE");
  return d.toFixed(4);
};
export type CommercialConfiguration = {
  version: string; currency: {code:string;decimalPlaces:"2"}; timezone:string;
  approval: {mode:"enabled"|"disabled";percentageThreshold?:string;amountThreshold?:string};
  zeroSubtotal?: "require_approval"|"not_required";
};
export function parseCommercialConfiguration(value: unknown): CommercialConfiguration {
  const row=object(value,["version","currency","timezone","approval","zeroSubtotal"]);
  const currency=object(row.currency,["code","decimalPlaces"]);
  if(typeof currency.code!=="string" || !isCurrencyCode(currency.code) || currency.decimalPlaces!==2) {
    throw new CommercialDocumentError("COMMERCIAL_CURRENCY_CONFIGURATION_REQUIRED");
  }
  const timezone=id(row.timezone);
  try { new Intl.DateTimeFormat("en-US",{timeZone:timezone}).format(new Date(0)); }
  catch { throw new CommercialDocumentError("COMMERCIAL_TIMEZONE_CONFIGURATION_REQUIRED"); }
  const a=object(row.approval,["mode","percentageThreshold","amountThreshold"]);
  if(a.mode!=="enabled" && a.mode!=="disabled") throw new CommercialDocumentError("COMMERCIAL_APPROVAL_POLICY_REQUIRED");
  if(a.mode==="disabled" && (a.percentageThreshold!==undefined || a.amountThreshold!==undefined)) throw new CommercialDocumentError("AMBIGUOUS_COMMERCIAL_POLICY");
  if(a.mode==="enabled" && a.percentageThreshold===undefined && a.amountThreshold===undefined) throw new CommercialDocumentError("COMMERCIAL_APPROVAL_THRESHOLD_REQUIRED");
  if(row.zeroSubtotal!==undefined && row.zeroSubtotal!=="require_approval" && row.zeroSubtotal!=="not_required") throw new CommercialDocumentError("INVALID_ZERO_SUBTOTAL_POLICY");
  return {version:id(row.version),currency:{code:currency.code,decimalPlaces:"2"},timezone,
    approval:{mode:a.mode,...(a.percentageThreshold===undefined?{}:{percentageThreshold:rate(a.percentageThreshold)}),
      ...(a.amountThreshold===undefined?{}:{amountThreshold:money(a.amountThreshold)})},
    ...(row.zeroSubtotal===undefined?{}:{zeroSubtotal:row.zeroSubtotal})};
}
export function commercialYear(now: Date, timezone: string): number {
  if(!Number.isFinite(now.getTime())) throw new CommercialDocumentError("INVALID_COMMERCIAL_DATE");
  const year=new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",calendar:"gregory",numberingSystem:"latn"}).format(now);
  const result=Number(year);
  if(!Number.isInteger(result)||result<1||result>9999) throw new CommercialDocumentError("INVALID_COMMERCIAL_YEAR");
  return result;
}
const discount = (value:unknown) => {
  const d=value===undefined?{}:object(value,["percentage","fixedAmount"]);
  return {percentage:rate(d.percentage??"0"),fixedAmount:money(d.fixedAmount??"0")};
};
export function normalizeQuoteRequest(value: unknown) {
  const row=object(value,["items","discount"]);
  if(!Array.isArray(row.items)||!row.items.length||row.items.length>100) throw new CommercialDocumentError("INVALID_COMMERCIAL_ITEMS");
  const items=row.items.map(value=>{
    const item=object(value,["position","description","quantity","unitPrice","taxRate","discount"]);
    const position=id(item.position);
    if(!/^(0|[1-9][0-9]*)$/.test(position)||position.length>32) throw new CommercialDocumentError("INVALID_ITEM_POSITION");
    const description=text(item.description,4000); if(!description.trim()) throw new CommercialDocumentError("ITEM_DESCRIPTION_REQUIRED");
    return {position,description,quantity:parseCommercialDecimal(item.quantity,"quantity").toFixed(4),
      unitPrice:money(item.unitPrice),taxRate:parseCommercialDecimal(item.taxRate,"taxRate").toFixed(4),discount:discount(item.discount)};
  }).sort((a,b)=>BigInt(a.position)<BigInt(b.position)?-1:BigInt(a.position)>BigInt(b.position)?1:0);
  return {items,discount:discount(row.discount)};
}
export function normalizeQuoteInput(value: unknown, configuration: CommercialConfiguration) {
  const normalized=normalizeQuoteRequest(value);
  const items=normalized.items;
  const engineInput={currency:configuration.currency.code,items:items.map(({description,...item})=>item),discount:normalized.discount};
  const pricingOutput=calculateCommercialQuote(engineInput,[{code:configuration.currency.code,decimalPlaces:2}]);
  const snapshotItems=items.map(({discount,...item},i)=>({...item,discountInput:discount,calculation:pricingOutput.lines[i]}));
  return {engineInput,items:snapshotItems,pricingOutput};
}
export function approvalRequired(configuration: CommercialConfiguration, output: ReturnType<typeof calculateCommercialQuote>): boolean {
  const cents=(value:string)=>BigInt(value.replace(".",""));
  const base=cents(output.originalSubtotal), discounted=cents(output.totalDiscount);
  if(base===0n) {
    if(!configuration.zeroSubtotal) throw new CommercialDocumentError("ZERO_SUBTOTAL_POLICY_REQUIRED");
    return configuration.zeroSubtotal==="require_approval";
  }
  if(configuration.approval.mode==="disabled") return false;
  const p=configuration.approval.percentageThreshold;
  const amount=configuration.approval.amountThreshold;
  return (p!==undefined && discounted*100n*10000n>base*BigInt(p.replace(".",""))) ||
    (amount!==undefined && discounted>cents(amount));
}
export function reconcileCommercialSnapshot(value: {
  canonicalInput:unknown;pricingOutput:unknown;contentHash:string;hashVersion:string;pricingVersion:string;
  policySnapshot:unknown;customerSnapshot:unknown;policyVersion:string;revisionVersion:number;expectedItemCount:number;
}) {
  if(value.hashVersion!==COMMERCIAL_HASH_VERSION||value.pricingVersion!==COMMERCIAL_PRICING_VERSION) throw new CommercialDocumentError("UNSUPPORTED_COMMERCIAL_VERSION",409);
  const wrapper=object(value.canonicalInput,["engineInput","contentEnvelope"]);
  const envelope=object(wrapper.contentEnvelope,["hashVersion","businessId","quotationId","quotationNumber","revisionId","revisionNumber","revisionVersion","ownerUserId","contactId","dealId","issueDate","validUntil","terms","notes","currency","timezone","customerSnapshot","policyVersion","policySnapshot","pricingVersion","items","pricingOutput"]);
  if(Object.keys(envelope).length!==22 || !Array.isArray(envelope.items)) throw new CommercialDocumentError("INCOMPLETE_COMMERCIAL_ENVELOPE",409);
  if(canonical(value.policySnapshot)!==canonical(envelope.policySnapshot)||canonical(value.customerSnapshot)!==canonical(envelope.customerSnapshot)||
      value.policyVersion!==envelope.policyVersion||String(value.revisionVersion)!==envelope.revisionVersion||value.expectedItemCount!==envelope.items.length) throw new CommercialDocumentError("COMMERCIAL_SNAPSHOT_MISMATCH",409);
  const input=wrapper.engineInput as Parameters<typeof calculateCommercialQuote>[0];
  object(input,["currency","items","discount"]);
  if(input.currency!==envelope.currency || envelope.hashVersion!==value.hashVersion || envelope.pricingVersion!==value.pricingVersion ||
      !Array.isArray(input.items) || input.items.length!==envelope.items.length) throw new CommercialDocumentError("COMMERCIAL_SNAPSHOT_MISMATCH",409);
  const output=calculateCommercialQuote(input,[{code:String(envelope.currency),decimalPlaces:2}]);
  for(let i=0;i<input.items.length;i++) {
    const item=object(envelope.items[i],["position","description","quantity","unitPrice","taxRate","discountInput","calculation"]);
    if(Object.keys(item).length!==7 || canonical({position:item.position,quantity:item.quantity,unitPrice:item.unitPrice,taxRate:item.taxRate,discount:item.discountInput})!==canonical(input.items[i]) ||
        canonical(item.calculation)!==canonical(output.lines[i])) throw new CommercialDocumentError("COMMERCIAL_SNAPSHOT_MISMATCH",409);
  }
  if(canonical(output)!==canonical(value.pricingOutput)||canonical(output)!==canonical(envelope.pricingOutput)||
      contentHash({...envelope,canonicalInput:wrapper})!==value.contentHash) throw new CommercialDocumentError("COMMERCIAL_SNAPSHOT_MISMATCH",409);
  return {envelope,output};
}
