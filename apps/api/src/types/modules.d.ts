/**
 * Ambient module declarations for packages without (or incomplete) types.
 * Keeps strict `tsc` builds green without skipLibCheck abuse.
 */

declare module "pdfkit" {
  import { EventEmitter } from "node:events";

  interface PDFDocumentOptions {
    margin?: number;
    size?: string | [number, number];
    layout?: "portrait" | "landscape";
    bufferPages?: boolean;
    autoFirstPage?: boolean;
    info?: Record<string, string>;
  }

  interface PDFTextOptions {
    align?: string;
    width?: number;
    height?: number;
    continued?: boolean;
    underline?: boolean;
    lineBreak?: boolean;
    ellipsis?: boolean | string;
    lineGap?: number;
  }

  class PDFDocument extends EventEmitter {
    constructor(options?: PDFDocumentOptions);
    y: number;
    x: number;
    page: { width: number; height: number };
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T;
    end(): void;
    addPage(options?: PDFDocumentOptions): this;
    switchToPage(pageNumber: number): this;
    bufferedPageRange(): { start: number; count: number };
    fontSize(size: number): this;
    font(name: string, size?: number): this;
    fillColor(color: string, opacity?: number): this;
    strokeColor(color: string, opacity?: number): this;
    lineWidth(w: number): this;
    text(
      text: string,
      x?: number | PDFTextOptions,
      y?: number | PDFTextOptions,
      options?: PDFTextOptions
    ): this;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(color?: string): this;
    fill(color?: string): this;
    rect(x: number, y: number, w: number, h: number): this;
    roundedRect(x: number, y: number, w: number, h: number, r?: number): this;
    save(): this;
    restore(): this;
    clip(rule?: string): this;
    image(
      src: string | Buffer,
      x?: number,
      y?: number,
      options?: { width?: number; height?: number; fit?: [number, number] }
    ): this;
    widthOfString(text: string, options?: object): number;
    heightOfString(text: string, options?: object): number;
  }

  export default PDFDocument;
}
