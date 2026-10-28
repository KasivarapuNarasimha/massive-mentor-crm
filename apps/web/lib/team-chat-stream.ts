/** Small bounded SSE parser shared by the chat provider and offline tests. */
export function chatFrames(buffer: string): { rest: string; refresh: boolean } {
  if (buffer.length > 65536) throw new Error("Chat stream frame too large");
  const frames=buffer.replace(/\r\n/g,"\n").split("\n\n");
  const rest=frames.pop() || "";
  return { rest, refresh:frames.some(frame=>frame.split("\n").some(line=>line.trim()==="event: chat_refresh")) };
}
