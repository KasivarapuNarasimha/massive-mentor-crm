"use client";
import React,{useEffect,useRef,useState} from "react";
import {useAuth} from "@/lib/auth-context";
import {useTeamChat,ChatRequestError} from "./TeamChatProvider";

export function TeamChatPanel({compact=false}:{compact?:boolean}){
  const c=useTeamChat(),{user}=useAuth();const [search,setSearch]=useState("");const [draft,setDraft]=useState("");
  const [dialog,setDialog]=useState<"direct"|"group"|"members"|null>(null),[memberSearch,setMemberSearch]=useState("");
  const [members,setMembers]=useState<Array<{id:string;name:string}>>([]),[chosen,setChosen]=useState<string[]>([]);
  const [name,setName]=useState(""),[description,setDescription]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[details,setDetails]=useState(false);
  const pending=useRef<{id:string;content:string;conversation:string}|null>(null),read=useRef({id:"",sequence:0});
  const end=useRef<HTMLDivElement>(null);const id=c.selected;const last=c.history?.messages.at(-1)?.sequence||0;
  const active=useRef(id);active.current=id;
  const {setViewing,read:markRead,request}=c;const historyVersion=c.history;
  const modal=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!dialog)return;const previous=document.activeElement as HTMLElement|null;
    const focusable=()=>Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')||[]);
    const timer=setTimeout(()=>focusable()[0]?.focus(),0);
    const key=(e:KeyboardEvent)=>{
      if(e.key==="Escape"){e.stopPropagation();setDialog(null);return;}
      if(e.key!=="Tab")return;const nodes=focusable(),first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",key);return()=>{clearTimeout(timer);document.removeEventListener("keydown",key);previous?.focus();};
  },[dialog]);
  useEffect(()=>{setViewing(true);return()=>setViewing(false);},[setViewing]);
  useEffect(()=>{setDraft("");setError("");pending.current=null;read.current={id:id||"",sequence:0};},[id]);
  useEffect(()=>{
    if(!id||!last||document.visibilityState!=="visible"||read.current.id!==id||read.current.sequence>=last)return;
    read.current.sequence=last;void markRead(last).catch(()=>{if(read.current.id===id)read.current.sequence=0;});
    end.current?.scrollIntoView({block:"nearest"});
  },[id,last,markRead,historyVersion]);
  useEffect(()=>{
    if(!dialog)return;let active=true;
    const timer=setTimeout(()=>{void request<Array<{id:string;name:string}>>(`/members?search=${encodeURIComponent(memberSearch)}`).then(rows=>{if(active)setMembers(rows);}).catch(e=>{if(active)setError(e.message);});},250);
    return()=>{active=false;clearTimeout(timer);};
  },[dialog,memberSearch,request]);
  async function send(){
    if(!id||busy||!draft.trim())return;setBusy(true);setError("");
    const item=pending.current||{id:crypto.randomUUID(),content:draft.trim(),conversation:id};pending.current=item;
    try{await c.request(`/conversations/${encodeURIComponent(item.conversation)}/messages`,{content:item.content,clientMessageId:item.id});if(active.current===item.conversation){setDraft("");pending.current=null;await c.refresh();}}
    catch(e){if(active.current===item.conversation){if(e instanceof ChatRequestError&&e.status&&e.status<500)pending.current=null;setError((e instanceof Error?e.message:"Send failed.")+(pending.current?" Retry reuses the same message ID; do not send a duplicate.":""));}}
    finally{setBusy(false);}
  }
  async function create(){
    if(busy)return;setBusy(true);setError("");
    try{
      if(dialog==="members"){await c.request(`/conversations/${id}/members`,{userIds:chosen});await c.refresh();}
      else{const result=await c.request<{id:string}>(dialog==="direct"?"/direct":"/groups",dialog==="direct"?{userId:chosen[0]}:{name,description,userIds:chosen});await c.refresh();c.select(result.id);}
      setDialog(null);setChosen([]);setName("");setDescription("");setMemberSearch("");
    }catch(e){setError(e instanceof Error?e.message:"Unable to create conversation.");}finally{setBusy(false);}
  }
  if(!c.enabled)return <p className="p-6 text-sm text-muted-foreground">Team Chat is not available for this workspace or permission set.</p>;
  const conversations=c.overview.conversations.filter(x=>`${x.name||x.peer||"Direct conversation"}`.toLowerCase().includes(search.toLowerCase()));
  const title=c.history?.conversation.name||c.overview.conversations.find(x=>x.id===id)?.peer||"Conversation";
  return <section aria-label="Team Chat" className={`flex min-h-0 overflow-hidden rounded-xl border border-border bg-card ${compact?"h-full":"h-[calc(100dvh-14rem)] min-h-[28rem]"}`}>
    <aside className={`${id?(compact?"hidden":"hidden md:flex"):"flex"} ${compact?"w-full":"w-full md:w-72"} flex-col border-r border-border min-h-0 shrink-0`}>
      <div className="p-4 border-b border-border"><h2 className="font-semibold">Team Chat <span className="text-sm text-muted-foreground">{c.overview.unreadTotal?`(${c.overview.unreadTotal} unread)`:""}</span></h2>
        <p role="status" className="text-xs text-muted-foreground mt-1">{c.status==="live"?"Connected":c.status==="offline"?"Offline — reconnect to send":c.status==="denied"?"Access ended":c.status==="reconnecting"?"Reconnecting…":"Connecting…"}</p>
        <label className="sr-only" htmlFor={compact?"quick-chat-search":"team-chat-search"}>Search conversations</label>
        <input id={compact?"quick-chat-search":"team-chat-search"} className="w-full mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search conversations"/>
        <div className="flex gap-2 mt-3">{c.overview.canSend&&<button type="button" className="rounded-md bg-primary text-primary-foreground text-xs px-3 py-2" onClick={()=>{setDialog("direct");setChosen([]);}}>New message</button>}{c.overview.canManage&&<button type="button" className="rounded-md border px-3 py-2 text-xs" onClick={()=>{setDialog("group");setChosen([]);}}>New group</button>}</div>
      </div>
      <div className="flex-1 overflow-y-auto" aria-label="Conversations">{!conversations.length?<p className="p-5 text-sm text-muted-foreground">{search?"No matching conversations.":"No conversations yet. Start a message with a teammate."}</p>:conversations.map(x=><button type="button" key={x.id} onClick={()=>c.select(x.id)} aria-current={id===x.id?"true":undefined} className={`block w-full text-left p-4 border-b border-border ${id===x.id?"bg-accent":"hover:bg-muted"}`}><span className="flex justify-between gap-2 text-sm font-medium"><span className="truncate">{x.name||x.peer||"Deleted member"}</span>{x.unread>0&&<span aria-label={`${x.unread} unread messages`} className="rounded-full bg-primary text-primary-foreground px-2 text-xs">{x.unread}</span>}</span><span className="block truncate text-xs text-muted-foreground mt-1">{x.preview||"No messages yet"}</span></button>)}</div>
      {c.error&&<div role="alert" className="p-3 text-xs text-destructive">{c.error}<button type="button" onClick={()=>void c.refresh()} className="underline ml-2">Retry</button></div>}
      <p className="p-2 text-[11px] text-muted-foreground">100 most recent conversations</p>
    </aside>
    <div className={`${id?"flex":compact?"hidden":"hidden md:flex"} flex-col flex-1 min-w-0 min-h-0`}>
      {!id?<div className="m-auto p-8 text-center text-muted-foreground"><h3 className="font-semibold text-foreground">Keep your team in sync</h3><p className="text-sm mt-2">Choose a conversation or start a new message.</p></div>:<>
        <header className="flex items-center gap-3 p-3 border-b border-border"><button type="button" onClick={()=>c.select(null)} aria-label="Back to conversations" className="rounded p-2 hover:bg-muted">←</button><h3 className="font-semibold text-sm truncate flex-1">{title}</h3><button type="button" onClick={()=>setDetails(v=>!v)} aria-expanded={details} className="text-xs underline">Details</button></header>
        {details&&<div className="border-b border-border p-3 max-h-40 overflow-y-auto text-xs"><p>{c.history?.conversation.description||"Internal conversation"}</p><ul className="mt-2 space-y-1">{c.history?.participants.map(p=><li key={p.id}>{p.name}{!p.active?" (inactive)":""}</li>)}</ul>{c.history?.conversation.kind==="group"&&c.overview.canManage&&<button type="button" className="mt-2 underline" onClick={()=>{setDialog("members");setChosen([]);}}>Add participants</button>}</div>}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" role="log" aria-label="Messages" aria-live="polite">
          {c.history?.nextBefore&&<button type="button" className="block mx-auto text-xs underline" onClick={()=>void c.older().catch(e=>setError(e.message))}>Load older messages</button>}
          {c.loading?<p role="status">Loading messages…</p>:!c.history?.messages.length?<p className="text-sm text-muted-foreground">No messages yet. Say hello.</p>:c.history.messages.map(m=><article key={m.id} className={`max-w-[90%] w-fit rounded-xl p-3 ${m.senderId===user?.id?"ml-auto bg-primary text-primary-foreground":"bg-muted"}`}><div className="text-xs font-semibold mb-1">{m.senderId?m.senderName:"Deleted member"}</div><p className="whitespace-pre-wrap break-words text-sm">{m.content}</p><time className="block text-[10px] mt-1 opacity-70" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time></article>)}<div ref={end}/>
        </div>
        {(error||c.error)&&<p role="alert" className="px-3 text-xs text-destructive">{error||c.error}</p>}
        <form onSubmit={e=>{e.preventDefault();void send();}} className="flex items-end gap-2 border-t border-border p-3">
          <textarea aria-label="Message" maxLength={4000} value={draft} disabled={busy||!!pending.current||!c.overview.canSend} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}} rows={2} className="resize-none min-w-0 flex-1 border border-border bg-background text-foreground rounded-lg p-2 text-sm" placeholder="Write a message…"/>
          <button type="submit" disabled={busy||!draft.trim()||c.status==="offline"||c.status==="denied"||!c.overview.canSend} className="rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm disabled:opacity-50">{busy?"Sending…":pending.current?"Retry":"Send"}</button>
        </form>
      </>}
    </div>
    {dialog&&<div role="dialog" aria-modal="true" aria-label={dialog==="direct"?"New message":dialog==="group"?"Create group":"Add participants"} className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"><div ref={modal} className="w-full max-w-md max-h-[85dvh] overflow-auto rounded-xl bg-card border p-5 space-y-3">
      <h3 className="font-semibold">{dialog==="direct"?"New message":dialog==="group"?"Create group":"Add participants"}</h3>
      {dialog==="group"&&<><label className="block text-sm">Group name<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} className="block w-full border rounded p-2 bg-background"/></label><label className="block text-sm">Description<input value={description} maxLength={500} onChange={e=>setDescription(e.target.value)} className="block w-full border rounded p-2 bg-background"/></label></>}
      <label className="block text-sm">Search team members<input value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} maxLength={80} className="block w-full border rounded p-2 bg-background"/></label>
      <div className="max-h-48 overflow-y-auto border rounded p-2">{members.length?members.map(m=><label key={m.id} className="flex gap-2 p-2 text-sm"><input type={dialog==="direct"?"radio":"checkbox"} name="chat-members" checked={chosen.includes(m.id)} onChange={()=>setChosen(prev=>dialog==="direct"?[m.id]:prev.includes(m.id)?prev.filter(x=>x!==m.id):[...prev,m.id])}/>{m.name}</label>):<p className="text-sm text-muted-foreground">No eligible teammates found.</p>}</div>
      {dialog!=="direct"&&<p className="text-xs text-muted-foreground">Participants can view this group’s message history. Maximum 50 participants.</p>}
      {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" onClick={()=>setDialog(null)}>Cancel</button><button type="button" disabled={busy||!chosen.length||(dialog==="group"&&!name.trim())} onClick={()=>void create()} className="rounded bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50">{busy?"Working…":dialog==="members"?"Add":"Continue"}</button></div>
    </div></div>}
  </section>;
}
