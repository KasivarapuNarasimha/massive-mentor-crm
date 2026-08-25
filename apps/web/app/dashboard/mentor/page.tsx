"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import Link from "next/link";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "sonner";
import { MarkdownContent } from "@/components/ai/MarkdownContent";
import { useAiQuotaModalOptional } from "@/lib/ai-quota-modal-context";
import { friendlyError } from "@/lib/user-messages";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

const SUGGESTED_PROMPTS = [
  "How can I increase sales?",
  "Create a marketing plan for my business.",
  "How can I get more customers?",
  "Analyze my business growth opportunities.",
];

export default function AIMentorPage() {
  const { token } = useAuth();
  const quotaModal = useAiQuotaModalOptional();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load chat history on mount
  useEffect(() => {
    const loadHistory = async () => {
      if (!token) return;

      setIsLoadingHistory(true);
      const response = await api.getMentorHistory(token);

      if (response.success && response.data?.messages) {
        setMessages(response.data.messages as Message[]);
      }
      setIsLoadingHistory(false);
    };

    loadHistory();
  }, [token]);

  const sendMessage = async (messageText: string) => {
    if (!token || !messageText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText.trim(),
      createdAt: new Date().toISOString(),
    };

    // Optimistically add user message
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    const response = await api.sendMentorMessage(messageText.trim(), token);

    if (response.success && response.data && response.data.message) {
      const assistantMessage = response.data.message as Message;
      // Add assistant message from server
      setMessages((prev) => [...prev, assistantMessage]);
    } else {
      if (!quotaModal?.handleAiQuotaResponse(response)) {
        toast.error(
          friendlyError(response.error, "Failed to get response from Massive Mentor AI.")
        );
      }
      // Remove the optimistic user message on error
      setMessages((prev) => prev.slice(0, -1));
    }

    setIsLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      sendMessage(input);
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    if (!isLoading) {
      sendMessage(prompt);
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoadingHistory) {
    return (
      <div className="flex h-[calc(100dvh-8rem)] md:h-[calc(100dvh-4rem)] flex-col max-w-4xl mx-auto px-3 sm:px-6 py-3 sm:py-4 overflow-x-hidden pb-20 md:pb-4">
        {/* Header skeleton */}
        <div className="border-b border-border py-3">
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="h-5 w-28 mb-1" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-4 w-28" />
          </div>
        </div>

        {/* Chat area skeleton */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3 bg-background">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[70%] rounded-lg px-3.5 py-2.5 ${i % 2 === 0 ? "bg-muted" : "mm-card"}`}>
                <Skeleton className="h-3 w-48 mb-1.5" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>

        {/* Input skeleton */}
        <div className="border-t border-border p-3 bg-background">
          <div className="flex gap-2">
            <Skeleton className="flex-1 h-9 rounded-lg" />
            <Skeleton className="h-9 w-16 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] md:h-[calc(100dvh-4rem)] flex-col max-w-4xl mx-auto px-3 sm:px-6 py-3 sm:py-4 overflow-x-hidden pb-20 md:pb-4">
      {/* Header */}
      <div className="border-b border-border py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="mm-page-title">AI Mentor</h1>
            <p className="mm-secondary mt-0.5">Personalized business advice powered by Massive Mentor AI</p>
          </div>
          <Link href="/dashboard" className="mm-secondary hover:text-foreground focus-ring shrink-0" aria-label="Back to dashboard overview">
            ← Back to Dashboard
          </Link>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3 bg-background">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-8">
            <div className="mx-auto w-10 h-10 bg-muted rounded-lg flex items-center justify-center mb-3">
              <span className="text-lg">💬</span>
            </div>
            <h3 className="text-base font-semibold mb-1">Welcome to your AI Mentor</h3>
            <p className="mm-secondary max-w-md mx-auto mb-5">
              Ask anything about growing your business. I have access to your profile and will give personalized advice.
            </p>

            {/* Suggested Prompts */}
            <div className="max-w-lg mx-auto">
              <p className="mm-secondary mb-2 text-left">Try asking:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_PROMPTS.map((prompt, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestedPrompt(prompt)}
                    className="text-left px-3 py-2.5 mm-card hover:bg-muted text-[13px] transition-colors focus-ring"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={message.id || index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed ${
                message.role === "user"
                  ? "bg-muted text-foreground"
                  : "mm-card text-foreground"
              }`}
            >
              {message.role === "assistant" ? (
                <MarkdownContent content={message.content} />
              ) : (
                <div className="whitespace-pre-wrap">{message.content}</div>
              )}
              <div className="text-[10px] mt-1.5 mm-secondary opacity-80">
                {formatTime(message.createdAt)}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="mm-card rounded-lg px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span>Mentor is thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border p-3 bg-background">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your AI Mentor anything about your business..."
            disabled={isLoading}
            className="mm-input flex-1"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="mm-btn mm-btn-primary focus-ring"
          >
            Send
          </button>
        </form>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Responses are generated by Massive Mentor AI and may not always be perfect. Use your judgment.
        </p>
      </div>
    </div>
  );
}
