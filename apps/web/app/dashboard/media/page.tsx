"use client";

import { MediaLibraryDashboard } from "@/components/media/MediaLibraryDashboard";

export default function MediaLibraryPage() {
  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-5 md:px-6 py-4 sm:py-5 space-y-3">
      <div>
        <h1 className="mm-page-title">Media Library</h1>
        <p className="mm-secondary mt-1">
          Enterprise document hub — brochures, catalogs, images & videos for WhatsApp and email.
        </p>
      </div>
      <MediaLibraryDashboard />
    </div>
  );
}
