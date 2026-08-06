"use client";

import { WhatsAppConversationCenter } from "@/components/whatsapp/WhatsAppConversationCenter";

export default function WhatsAppPage() {
  return (
    <div className="h-[calc(100dvh-7rem)] min-h-[520px] flex flex-col">
      <div className="mb-3 shrink-0">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Conversation Center — chat, assign, follow up, and use AI without leaving the CRM.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <WhatsAppConversationCenter />
      </div>
    </div>
  );
}
