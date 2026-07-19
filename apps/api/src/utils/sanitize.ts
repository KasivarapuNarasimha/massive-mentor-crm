/**
 * Minimal sanitization for user-provided data inserted into AI prompts.
 * Goal: Reduce (not eliminate) prompt injection risk with smallest possible change.
 */
export function sanitizePromptInput(input: string | null | undefined): string {
  if (!input) return 'Not specified';

  return input
    // Escape common instruction delimiters
    .replace(/`/g, "'")
    .replace(/```/g, "'''")
    .replace(/\${/g, '\\${')
    // Collapse excessive whitespace/newlines that could be used for formatting attacks
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    // Hard cap length to prevent token stuffing / huge injections
    .slice(0, 1500);
}
