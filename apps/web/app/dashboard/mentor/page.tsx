"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import Link from "next/link";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "sonner";
import { MarkdownContent } from "@/components/ai/MarkdownContent";

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
      toast.error(response.error || "Failed to get response from AI Mentor.");
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
      <div className="flex h-[calc(100dvh-8rem)] md:h-[calc(100dvh-4rem)] flex-col max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6 overflow-x-hidden pb-20 md:pb-6">
        {/* Header skeleton */}
        <div className="border-b border-border py-4">
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="h-6 w-28 mb-1" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-4 w-28" />
          </div>
        </div>

        {/* Chat area skeleton */}
        <div className="flex-1 overflow-y-auto py-6 space-y-6 bg-background">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[70%] rounded-2xl px-5 py-3 ${i % 2 === 0 ? "bg-white/10" : "bg-card border border-border"}`}>
                <Skeleton className="h-3 w-48 mb-1.5" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>

        {/* Input skeleton */}
        <div className="border-t border-border p-4 bg-background">
          <div className="flex gap-3">
            <Skeleton className="flex-1 h-12 rounded-2xl" />
            <Skeleton className="h-12 w-20 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] md:h-[calc(100dvh-4rem)] flex-col max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6 overflow-x-hidden pb-20 md:pb-6">
      {/* Header */}
      <div className="border-b border-border py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Mentor</h1>
            <p className="text-sm text-muted-foreground">Personalized business advice powered by Massive Mentor AI</p>
          </div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground focus-ring" aria-label="Back to dashboard overview">
            ← Back to Dashboard
          </Link>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-6 space-y-6 bg-background">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <div className="mx-auto w-16 h-16 bg-card rounded-2xl flex items-center justify-center mb-6">
              <span className="text-3xl">💬</span>
            </div>
            <h3 className="text-xl font-semibold mb-2">Welcome to your AI Mentor</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-8">
              Ask anything about growing your business. I have access to your profile and will give personalized advice.
            </p>

            {/* Suggested Prompts */}
            <div className="max-w-lg mx-auto">
              <p className="text-sm text-muted-foreground mb-3 text-left">Try asking:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_PROMPTS.map((prompt, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestedPrompt(prompt)}
                    className="text-left px-4 py-3 bg-card hover:bg-muted border border-border rounded-xl text-sm transition-colors focus-ring focus-visible:border-white/30"
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
              className={`max-w-[80%] rounded-2xl px-5 py-3 text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-none"
                  : "bg-card border border-border text-foreground rounded-bl-none"
              }`}
            >
              {message.role === "assistant" ? (
                <MarkdownContent content={message.content} />
              ) : (
                <div className="whitespace-pre-wrap">{message.content}</div>
              )}
              <div
                className={`text-[10px] mt-1.5 opacity-60 ${
                  message.role === "user" ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {formatTime(message.createdAt)}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-2xl rounded-bl-none px-5 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
      <div className="border-t border-border p-4 sm:p-6 bg-background">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your AI Mentor anything about your business..."
            disabled={isLoading}
            className="flex-1 bg-card border border-border rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-border focus:ring-1 focus:ring-white/30 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-2xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Responses are generated using Groq and may not always be perfect. Use your judgment.
        </p>
      </div>
    </div>
  );
}
