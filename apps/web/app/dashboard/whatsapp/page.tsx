"use client";

import { WhatsAppConversationCenter } from "@/components/whatsapp/WhatsAppConversationCenter";

export default function WhatsAppPage() {
  return (
    <div className="h-[calc(100dvh-7rem)] min-h-[520px] flex flex-col px-4 sm:px-5 md:px-6">
      <div className="mb-2 shrink-0 pt-3 sm:pt-4">
        <h1 className="mm-page-title">WhatsApp</h1>
        <p className="mm-secondary mt-0.5">
          Conversation Center — chat, assign, follow up, and use AI without leaving the CRM.
        </p>
      </div>
      <div className="flex-1 min-h-0 pb-4">
        <WhatsAppConversationCenter />
      </div>
    </div>
  );
}
