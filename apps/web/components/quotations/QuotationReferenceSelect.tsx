"use client";
import {useEffect,useState} from "react";
import {API_BASE_URL} from "@/lib/api";
type Option={id:string;name?:string;title?:string;email?:string|null;phone?:string|null;company?:string|null};
export function QuotationReferenceSelect({kind,value,contactId,businessId,token,disabled,onChange}:{kind:"contact"|"deal";value:string;contactId?:string;businessId:string;token:string;disabled:boolean;onChange:(id:string)=>void}){
 const [search,setSearch]=useState(""),[options,setOptions]=useState<Option[]>([]),[error,setError]=useState("");
 useEffect(()=>{setOptions([]);setError("");if(!businessId||!token||disabled||kind==="deal"&&!contactId)return;
 const controller=new AbortController();const timer=setTimeout(async()=>{try{
 const params=new URLSearchParams({kind,search,...(contactId?{contactId}:{})});
 const response=await fetch(API_BASE_URL+"/quotations/references?"+params,{headers:{authorization:"Bearer "+token,"x-business-id":businessId},cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
 const result=await response.json();if(!response.ok||!result.success)throw Error("Customer/deal selection unavailable for this workspace or permission.");
 setOptions(result.data);
 }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Selection unavailable");}},250);
 return()=>{clearTimeout(timer);controller.abort();};
 },[kind,search,contactId,businessId,token,disabled]);
 const selected=options.find(o=>o.id===value);
 return <div><label className="block">{kind==="contact"?"Customer (Lead / Client)":"Originating deal"}<input className="w-full rounded border bg-background p-2" placeholder={"Search "+(kind==="contact"?"customers":"deals")} value={search} disabled={disabled} onChange={e=>setSearch(e.target.value)}/></label>
 <select aria-label={kind==="contact"?"Select customer":"Select deal"} className="mt-2 w-full rounded border bg-background p-2" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">{kind==="deal"?"No deal":"Select customer"}</option>{value&&!selected&&<option value={value}>Current linked {kind}</option>}{options.map(o=><option key={o.id} value={o.id}>{o.name||o.title}{o.email?" · "+o.email:""}</option>)}</select>
 {selected&&<p className="text-sm text-muted-foreground">{[selected.name,selected.email,selected.phone,selected.company].filter(Boolean).join(" · ")}</p>}{error&&<p role="alert">{error}</p>}</div>;
}
