/** Reconcile durable history after disconnects without concealing a missing page. */
export function mergeChatHistory<T extends {id:string;sequence:number}>(old:T[],incoming:T[],previousBefore:number|null,nextBefore:number|null,older:boolean){
  if(!older&&(!incoming.length||old.length&&incoming[0].sequence>old[old.length-1].sequence+1))return{messages:incoming,nextBefore};
  const messages=[...new Map([...old,...incoming].map(m=>[m.id,m])).values()].sort((a,b)=>a.sequence-b.sequence);
  return{messages,nextBefore:older?nextBefore:old.length&&incoming.length&&old[0].sequence<incoming[0].sequence?previousBefore:nextBefore};
}
