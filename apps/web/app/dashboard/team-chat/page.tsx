"use client";
import {TeamChatPanel} from "@/components/team-chat/TeamChatPanel";
import {useTeamChat} from "@/components/team-chat/TeamChatProvider";
export default function TeamChatPage(){const c=useTeamChat();return <div className="p-3 sm:p-5"><h1 className="text-xl font-semibold mb-4">Team Chat</h1><TeamChatPanel key={c.workspaceKey}/></div>;}
