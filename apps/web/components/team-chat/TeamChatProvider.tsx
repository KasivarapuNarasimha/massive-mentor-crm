"use client";
import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {toast} from "sonner";
import {useAuth} from "@/lib/auth-context";
import {usePortal} from "@/lib/portal-context";
import {usePlan} from "@/lib/plan-context";
import {API_BASE_URL} from "@/lib/api";
import {canAccessPath} from "@/lib/module-permissions";
import {chatFrames} from "@/lib/team-chat-stream";
import {mergeChatHistory} from "@/lib/team-chat-state";

export type ChatMessage={id:string;conversationId:string;senderId:string|null;senderName:string;content:string;sequence:number;createdAt:string;clientMessageId:string};
export type Conversation={id:string;kind:"direct"|"group";name:string|null;description:string|null;peer:string|null;preview:string|null;lastSequence:number;lastReadSequence:number;unread:number;updatedAt:string};
export type History={conversation:Conversation;messages:ChatMessage[];participants:Array<{id:string;name:string;active:boolean}>;nextBefore:number|null};
type Overview={conversations:Conversation[];unreadTotal:number;canManage:boolean;canSend:boolean};
type Status="connecting"|"live"|"reconnecting"|"offline"|"denied";
type ChatContextType={enabled:boolean;workspaceKey:string;status:Status;overview:Overview;history:History|null;selected:string|null;error:string;loading:boolean;
  request:<T>(path:string,body?:unknown)=>Promise<T>;select:(id:string|null)=>void;refresh:()=>Promise<void>;
  older:()=>Promise<void>;setViewing:(v:boolean)=>void;read:(sequence:number)=>Promise<void>};
const Context=createContext<ChatContextType|null>(null);
const EMPTY:Overview={conversations:[],unreadTotal:0,canManage:false,canSend:false};
export class ChatRequestError extends Error{constructor(message:string,public status?:number){super(message);}}
export function TeamChatProvider({children}:{children:React.ReactNode}){
  const {token,isAuthenticated,user}=useAuth();const {portal}=usePortal();const {isLocked,accessKnown}=usePlan();const pathname=usePathname();
  const enabled=!!(token&&isAuthenticated&&portal?.modules.includes("team_chat")&&!portal.isWorkspacePreview&&!isLocked&&accessKnown&&canAccessPath(pathname||"",portal.modules,{loaded:true}));
  const scope=enabled?`${token}:${portal?.businessId}`:"";
  const current=useRef(scope);current.current=scope;
  const [state,setState]=useState<{scope:string;overview:Overview;history:History|null;selected:string|null}>({scope:"",overview:EMPTY,history:null,selected:null});
  const [status,setStatus]=useState<Status>("connecting");const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  const selected=useRef<string|null>(null),viewing=useRef(false),inflight=useRef(false),seenUnread=useRef<number|null>(null);
  const controllers=useRef(new Set<AbortController>());
  const request=useCallback(async<T,>(path:string,body?:unknown):Promise<T>=>{
    const identity=scope;if(!identity||!token||!portal?.businessId)throw new Error("Team Chat access required.");
    const ac=new AbortController();controllers.current.add(ac);const timer=setTimeout(()=>ac.abort(),15000);
    try{
      const r=await fetch(`${API_BASE_URL}/team-chat${path}`,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${token}`,"x-business-id":portal.businessId,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body),credentials:"omit",cache:"no-store",signal:ac.signal});
      const result=await r.json();if(current.current!==identity)throw new Error("Workspace changed.");
      if(!r.ok||!result.success){
        if(r.status===401||r.status===403&&["CHAT_ACCESS_DENIED","CHAT_SESSION_REVOKED","CHAT_SESSION_EXPIRED"].includes(result.code)){setStatus("denied");setState({scope:identity,overview:EMPTY,history:null,selected:null});selected.current=null;}
        if(r.status===404){const missing=path.match(/^\/conversations\/([^/]+)/)?.[1];if(missing===selected.current){selected.current=null;setState(prev=>({...prev,selected:null,history:null}));}}
        throw new ChatRequestError(r.status===429?"Too many requests. Wait a minute before retrying.":r.status===401||r.status===403?"Chat access ended. Refresh your workspace or sign in again.":r.status===404?"This conversation is no longer available.":r.status===409?"The request conflicted. Refresh before retrying.":"Team Chat request failed. Please retry.",r.status);
      }
      return result.data as T;
    }catch(e){if(ac.signal.aborted)throw new Error("Request interrupted. Delivery may be unconfirmed.");throw e;}
    finally{clearTimeout(timer);controllers.current.delete(ac);}
  },[scope,token,portal?.businessId]);
  const history=useCallback(async(id:string,before?:number)=>{
    const identity=scope;const data=await request<History>(`/conversations/${encodeURIComponent(id)}/messages${before?`?before=${before}`:""}`);
    if(current.current!==identity||selected.current!==id)return;
    setState(prev=>{
      const old=prev.scope===identity&&prev.history?.conversation.id===id?prev.history.messages:[];
      const merged=mergeChatHistory(old,data.messages,prev.history?.nextBefore??null,data.nextBefore,!!before);
      return {...prev,scope:identity,selected:id,history:{...data,...merged}};
    });
  },[scope,request]);
  const refresh=useCallback(async()=>{
    if(!scope||inflight.current)return;inflight.current=true;const identity=scope;
    try{
      const data=await request<Overview>("/conversations");if(current.current!==identity)return;
      if(seenUnread.current!==null&&data.unreadTotal>seenUnread.current&&document.visibilityState==="visible")toast.info("New team message");
      seenUnread.current=data.unreadTotal;
      setState(prev=>({...prev,scope:identity,overview:data}));setError("");
      if(viewing.current&&selected.current)await history(selected.current);
    }catch(e){if(current.current===identity)setError(e instanceof Error?e.message:"Unable to load conversations.");}
    finally{if(current.current===identity)inflight.current=false;}
  },[scope,request,history]);
  const select=useCallback((id:string|null)=>{
    selected.current=id;setState(prev=>({...prev,scope,selected:id,history:null}));setError("");
    if(id){setLoading(true);void history(id).catch(e=>{if(selected.current===id)setError(e instanceof Error?e.message:"Unable to load messages.");}).finally(()=>{if(selected.current===id)setLoading(false);});}
  },[scope,history]);
  useEffect(()=>{
    const identity=scope;selected.current=null;inflight.current=false;seenUnread.current=null;
    const requestControllers=controllers.current;
    setState({scope,overview:EMPTY,history:null,selected:null});setError("");
    if(!scope||!token||!portal?.businessId)return;
    const ac=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let retry=0;
    const run=async()=>{
      if(ac.signal.aborted||current.current!==identity)return;
      if(!navigator.onLine){setStatus("offline");timer=setTimeout(()=>void run(),3000);return;}
      setStatus(retry?"reconnecting":"connecting");
      try{
        const r=await fetch(`${API_BASE_URL}/team-chat/stream`,{headers:{Authorization:`Bearer ${token}`,"x-business-id":portal.businessId,Accept:"text/event-stream"},credentials:"omit",signal:ac.signal,cache:"no-store"});
        if(r.status===401||r.status===403){setStatus("denied");setState({scope:identity,overview:EMPTY,history:null,selected:null});return;}
        if(!r.ok||!r.body)throw new Error("Stream unavailable");
        setStatus("live");retry=0;void refresh();const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="";
        try{while(!ac.signal.aborted){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});const frame=chatFrames(buffer);buffer=frame.rest;if(frame.refresh)void refresh();}}
        finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
      }catch{if(ac.signal.aborted)return;setStatus(navigator.onLine?"reconnecting":"offline");retry++;void refresh();}
      if(!ac.signal.aborted)timer=setTimeout(()=>void run(),Math.min(30000,1000*2**Math.min(retry,5)));
    };
    void refresh();void run();
    const visible=()=>{if(document.visibilityState==="visible")void refresh();};document.addEventListener("visibilitychange",visible);
    return()=>{ac.abort();if(timer)clearTimeout(timer);for(const c of requestControllers)c.abort();requestControllers.clear();document.removeEventListener("visibilitychange",visible);};
  },[scope,token,portal?.businessId,refresh]);
  const shown=state.scope===scope?state:{scope,overview:EMPTY,history:null,selected:null};
  const setViewing=useCallback((value:boolean)=>{viewing.current=value;},[]);
  const markRead=useCallback(async(sequence:number)=>{const id=selected.current;if(id){await request(`/conversations/${id}/read`,{sequence});await refresh();}},[request,refresh]);
  return <Context.Provider value={{enabled:enabled&&status!=="denied",workspaceKey:enabled?`${user?.id}:${portal?.businessId}`:"",status,overview:shown.overview,history:shown.history,selected:shown.selected,error,loading,request,select,refresh,
    setViewing,older:async()=>{if(selected.current&&shown.history?.nextBefore)await history(selected.current,shown.history.nextBefore);},read:markRead}}>{children}</Context.Provider>;
}
export function useTeamChat(){const c=useContext(Context);if(!c)throw new Error("TeamChatProvider required");return c;}
