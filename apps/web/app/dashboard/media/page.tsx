"use client";

import { MediaLibraryDashboard } from "@/components/media/MediaLibraryDashboard";

export default function MediaLibraryPage() {
  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-6 space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Media Library</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enterprise document hub — brochures, catalogs, images & videos for WhatsApp and email.
        </p>
      </div>
      <MediaLibraryDashboard />
    </div>
  );
}
