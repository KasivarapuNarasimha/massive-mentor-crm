import { buildManifest, type SeedTemplateMeta } from "@/templates/build-manifest";
import type { IndustryTemplateManifest } from "@/types/template-manifest";

/**
 * Seed catalog definitions — pure data.
 * Engines must never switch on slug; they only read BusinessConfig.
 */
const SEED_DEFS: SeedTemplateMeta[] = [
  {
    slug: "generic",
    name: "Other / Generic",
    description: "Default business template for any industry",
    category: "general",
  },
  {
    slug: "coaching_institute",
    name: "Coaching Institute",
    description: "Admissions, batches, fees, counsellors",
    category: "education",
    extraFields: [
      { key: "parent_name", label: "Parent Name", entity: "contact", type: "text", showInForm: true, showInList: true, order: 10 },
      { key: "course", label: "Course", entity: "contact", type: "text", showInForm: true, showInList: true, showInFilter: true, order: 11 },
      { key: "batch", label: "Batch", entity: "contact", type: "text", showInForm: true, showInList: true, showInFilter: true, order: 12 },
      { key: "fee", label: "Fee", entity: "contact", type: "currency", showInForm: true, showInList: true, order: 13 },
      { key: "counsellor", label: "Counsellor", entity: "contact", type: "text", showInForm: true, showInList: true, order: 14 },
      { key: "district", label: "District", entity: "contact", type: "text", showInForm: true, showInList: true, showInFilter: true, order: 15 },
      { key: "group", label: "Group", entity: "contact", type: "text", showInForm: true, showInFilter: true, order: 16 },
    ],
    extraImportMappings: [
      { sourceHeader: "fathername", fieldKey: "parent_name" },
      { sourceHeader: "father_name", fieldKey: "parent_name" },
      { sourceHeader: "parentname", fieldKey: "parent_name" },
      { sourceHeader: "course", fieldKey: "course" },
      { sourceHeader: "batch", fieldKey: "batch" },
      { sourceHeader: "fee", fieldKey: "fee" },
      { sourceHeader: "counsellor", fieldKey: "counsellor" },
      { sourceHeader: "district", fieldKey: "district" },
      { sourceHeader: "group", fieldKey: "group" },
      { sourceHeader: "collegename", fieldKey: "company" },
    ],
    extraWidgets: [
      {
        key: "admissions",
        type: "metric_count",
        title: "Admissions",
        source: { entity: "contact", filters: [{ field: "type", op: "eq", value: "lead" }], aggregate: "count" },
        layout: { w: 3, h: 1, x: 0, y: 1 },
      },
      {
        key: "todays_followups",
        type: "tasks_due",
        title: "Today's Followups",
        source: { entity: "task", filters: [{ field: "status", op: "neq", value: "done" }], aggregate: "count" },
        layout: { w: 3, h: 1, x: 3, y: 1 },
      },
    ],
    extraAiFeatures: [
      {
        key: "fee_reminder",
        label: "Fee Reminder",
        enabled: true,
        output: "text",
        promptTemplate:
          "Write a polite fee reminder WhatsApp for student {{contactName}} at {{businessName}}. Fee/context: {{customFields}}. Output message only.",
      },
      {
        key: "parent_whatsapp",
        label: "Parent WhatsApp",
        enabled: true,
        output: "text",
        promptTemplate:
          "Write a WhatsApp message to the parent of {{contactName}} for {{businessName}}. Context: {{customFields}} {{description}}. Output message only.",
      },
      {
        key: "admission_prediction",
        label: "Admission Prediction",
        enabled: true,
        output: "json",
        promptTemplate:
          "Predict admission likelihood 0-100 for {{contactName}}. Data: {{customFields}} {{description}}. Return JSON { \"score\": number, \"reason\": string }",
      },
    ],
  },
  {
    slug: "real_estate",
    name: "Real Estate",
    description: "Buyers, budgets, properties, site visits",
    category: "real_estate",
    extraFields: [
      { key: "budget", label: "Budget", entity: "contact", type: "currency", showInForm: true, showInList: true, order: 10 },
      { key: "location", label: "Location", entity: "contact", type: "text", showInForm: true, showInList: true, showInFilter: true, order: 11 },
      { key: "property", label: "Property", entity: "contact", type: "text", showInForm: true, showInList: true, order: 12 },
      { key: "bhk", label: "BHK", entity: "contact", type: "select", options: ["1", "2", "3", "4", "5+"], showInForm: true, showInFilter: true, order: 13 },
      { key: "loan_status", label: "Loan Status", entity: "contact", type: "select", options: ["not_applied", "in_process", "approved", "rejected"], showInForm: true, showInFilter: true, order: 14 },
      { key: "site_visit", label: "Site Visit", entity: "contact", type: "date", showInForm: true, showInList: true, order: 15 },
    ],
    extraImportMappings: [
      { sourceHeader: "budget", fieldKey: "budget" },
      { sourceHeader: "location", fieldKey: "location" },
      { sourceHeader: "property", fieldKey: "property" },
      { sourceHeader: "bhk", fieldKey: "bhk" },
      { sourceHeader: "loan_status", fieldKey: "loan_status" },
      { sourceHeader: "site_visit", fieldKey: "site_visit" },
    ],
    extraWidgets: [
      {
        key: "bookings",
        type: "metric_count",
        title: "Bookings",
        source: { entity: "contact", filters: [{ field: "status", op: "eq", value: "won" }], aggregate: "count" },
        layout: { w: 3, h: 1, x: 0, y: 1 },
      },
    ],
    extraAiFeatures: [
      {
        key: "property_recommendation",
        label: "Property Recommendation",
        enabled: true,
        output: "text",
        promptTemplate:
          "Recommend properties for {{contactName}} at {{businessName}}. Preferences: {{customFields}}. Write a short recommendation.",
      },
      {
        key: "loan_followup",
        label: "Loan Follow-up",
        enabled: true,
        output: "text",
        promptTemplate: "Write a loan follow-up message for {{contactName}}. Loan context: {{customFields}}.",
      },
      {
        key: "site_visit_suggestion",
        label: "Site Visit Suggestion",
        enabled: true,
        output: "text",
        promptTemplate: "Suggest a site visit message for {{contactName}}. Context: {{customFields}}.",
      },
    ],
  },
  {
    slug: "hospital",
    name: "Hospital",
    description: "Patients, doctors, appointments",
    category: "healthcare",
    extraFields: [
      { key: "patient", label: "Patient", entity: "contact", type: "text", coreMap: "name", showInForm: true, showInList: true, order: 1 },
      { key: "doctor", label: "Doctor", entity: "contact", type: "text", showInForm: true, showInList: true, showInFilter: true, order: 10 },
      { key: "appointment", label: "Appointment", entity: "contact", type: "datetime", showInForm: true, showInList: true, order: 11 },
      { key: "diagnosis", label: "Diagnosis", entity: "contact", type: "textarea", showInForm: true, order: 12 },
      { key: "prescription", label: "Prescription", entity: "contact", type: "textarea", showInForm: true, order: 13 },
    ],
    extraImportMappings: [
      { sourceHeader: "patient", fieldKey: "name" },
      { sourceHeader: "doctor", fieldKey: "doctor" },
      { sourceHeader: "appointment", fieldKey: "appointment" },
      { sourceHeader: "diagnosis", fieldKey: "diagnosis" },
    ],
    extraAiFeatures: [
      {
        key: "appointment_reminder",
        label: "Appointment Reminder",
        enabled: true,
        output: "text",
        promptTemplate: "Write an appointment reminder for {{contactName}}. Details: {{customFields}}.",
      },
      {
        key: "medicine_reminder",
        label: "Medicine Reminder",
        enabled: true,
        output: "text",
        promptTemplate: "Write a medicine reminder for {{contactName}}. Prescription context: {{customFields}}.",
      },
      {
        key: "patient_followup",
        label: "Patient Follow-up",
        enabled: true,
        output: "text",
        promptTemplate: "Write a patient follow-up message for {{contactName}}. Context: {{customFields}} {{description}}.",
      },
    ],
  },
  {
    slug: "digital_marketing",
    name: "Digital Marketing Agency",
    description: "Clients, campaigns, proposals, ROI",
    category: "marketing",
    extraFields: [
      { key: "service", label: "Service", entity: "contact", type: "text", showInForm: true, showInList: true, order: 10 },
      { key: "channel", label: "Channel", entity: "contact", type: "select", options: ["seo", "ads", "social", "content", "mixed"], showInForm: true, showInFilter: true, order: 11 },
      { key: "campaign_budget", label: "Campaign Budget", entity: "contact", type: "currency", showInForm: true, order: 12 },
    ],
    extraImportMappings: [
      { sourceHeader: "service", fieldKey: "service" },
      { sourceHeader: "channel", fieldKey: "channel" },
      { sourceHeader: "budget", fieldKey: "campaign_budget" },
    ],
    extraAiFeatures: [
      {
        key: "proposal_generator",
        label: "Proposal Generator",
        enabled: true,
        output: "json",
        promptTemplate:
          "Generate a marketing proposal outline for {{contactName}} at {{businessName}}. Needs: {{customFields}}. Return JSON { \"title\": string, \"sections\": string[] }",
      },
      {
        key: "campaign_suggestions",
        label: "Campaign Suggestions",
        enabled: true,
        output: "json",
        promptTemplate:
          "Suggest 3 campaigns for {{contactName}}. Context: {{customFields}}. Return JSON { \"campaigns\": string[] }",
      },
      {
        key: "roi_forecast",
        label: "ROI Forecast",
        enabled: true,
        output: "json",
        promptTemplate:
          "Forecast ROI for {{contactName}} given {{customFields}}. Return JSON { \"forecast\": string, \"confidence\": number }",
      },
    ],
  },
  // Thin clones for catalog completeness (registration industry list)
  { slug: "school", name: "School", description: "Students, classes, admissions", category: "education" },
  { slug: "college", name: "College", description: "Students, courses, admissions", category: "education" },
  { slug: "clinic", name: "Clinic", description: "Patients and appointments", category: "healthcare" },
  { slug: "hotel", name: "Hotel", description: "Guests and bookings", category: "hospitality" },
  { slug: "restaurant", name: "Restaurant", description: "Guests and reservations", category: "hospitality" },
  { slug: "gym", name: "Gym", description: "Members and memberships", category: "fitness" },
  { slug: "salon", name: "Salon", description: "Clients and appointments", category: "beauty" },
  { slug: "insurance", name: "Insurance", description: "Policies and renewals", category: "finance" },
  { slug: "retail", name: "Retail", description: "Customers and orders", category: "retail" },
  { slug: "finance", name: "Finance", description: "Clients and portfolios", category: "finance" },
  { slug: "manufacturing", name: "Manufacturing", description: "Buyers and orders", category: "manufacturing" },
  { slug: "construction", name: "Construction", description: "Projects and clients", category: "construction" },
  { slug: "education", name: "Education", description: "Students and programs", category: "education" },
  { slug: "software_company", name: "Software Company", description: "Leads and SaaS pipeline", category: "technology" },
  { slug: "travel", name: "Travel", description: "Travelers and packages", category: "travel" },
  { slug: "ngo", name: "NGO", description: "Donors, beneficiaries, programs", category: "nonprofit" },
];

export function getAllSeedManifests(): IndustryTemplateManifest[] {
  return SEED_DEFS.map((def) => buildManifest(def));
}

export function getSeedManifestBySlug(slug: string): IndustryTemplateManifest | undefined {
  return getAllSeedManifests().find((m) => m.slug === slug);
}
