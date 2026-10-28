"use client";
import React,{useEffect,useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useTeamChat} from "./TeamChatProvider";
import {TeamChatPanel} from "./TeamChatPanel";
export function QuickChat({hidden=false}:{hidden?:boolean}){
  const c=useTeamChat(),path=usePathname();const [open,setOpen]=useState(false);
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[open]);
  if(hidden||!c.enabled||path?.startsWith("/dashboard/team-chat"))return null;
  return <div className="fixed right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-5 z-[45]">
    {open&&<section aria-label="Quick Team Chat" className="mb-3 w-[min(24rem,calc(100vw-1.5rem))] h-[min(38rem,calc(100dvh-12rem))] min-h-72 rounded-xl border bg-card shadow-xl flex flex-col"><header className="flex items-center justify-between p-3 border-b"><Link href="/dashboard/team-chat" className="text-xs underline">Open full Team Chat</Link><button type="button" onClick={()=>setOpen(false)} aria-label="Close quick chat">✕</button></header><div className="min-h-0 flex-1"><TeamChatPanel key={c.workspaceKey} compact/></div></section>}
    <button type="button" aria-label={`Team Chat${c.overview.unreadTotal?`, ${c.overview.unreadTotal} unread messages`:""}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="ml-auto flex gap-2 items-center rounded-full bg-primary text-primary-foreground shadow-lg border px-4 py-3 text-sm">Chat{c.overview.unreadTotal>0&&<span className="rounded-full bg-background text-foreground px-2 text-xs">{c.overview.unreadTotal}</span>}</button>
  </div>;
}
