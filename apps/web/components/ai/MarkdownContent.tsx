"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

function safeHref(href?: string): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("/")
  ) {
    return trimmed;
  }
  return undefined;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold tracking-tight text-foreground mt-3 mb-2 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold tracking-tight text-foreground mt-3 mb-2 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold tracking-tight text-foreground mt-2.5 mb-1.5 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-foreground mt-2 mb-1 first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-2 last:mb-0 ml-4 list-disc space-y-1 text-sm leading-relaxed">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 last:mb-0 ml-4 list-decimal space-y-1 text-sm leading-relaxed">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) {
      return <span className="underline decoration-dotted">{children}</span>;
    }
    const external = safe.startsWith("http://") || safe.startsWith("https://");
    return (
      <a
        href={safe}
        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock) {
      return (
        <code className={`${className || ""} text-[12px]`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-white/10 px-1 py-0.5 text-[12px] font-mono text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 last:mb-0 overflow-x-auto rounded-xl border border-border bg-black/30 p-3 text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 last:mb-0 border-l-2 border-border pl-3 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="mb-2 last:mb-0 w-full overflow-x-auto rounded-xl border border-border">
      <table className="min-w-full border-collapse text-left text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 text-foreground/90 align-top">{children}</td>,
};

type MarkdownContentProps = {
  content: string;
  className?: string;
};

/**
 * Safe Markdown renderer for AI assistant responses.
 * Uses react-markdown (React elements — not raw HTML injection).
 */
export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div className={`mm-md text-sm leading-relaxed ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}
