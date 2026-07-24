import type { IndustryTemplateManifest } from "../types/template-manifest.js";

const DEFAULT_PERMISSIONS = [
  "contacts.read",
  "contacts.write",
  "deals.read",
  "deals.write",
  "tasks.read",
  "tasks.write",
  "reports.read",
  "reports.export",
  "reports.import",
  "ai.use",
  "config.edit",
  "members.manage",
  "audit.read",
];

const DEFAULT_MODULES: IndustryTemplateManifest["modules"] = [
  { key: "overview", label: "Overview", enabled: true, route: "/dashboard", order: 1 },
  { key: "leads", label: "Leads", enabled: true, route: "/dashboard/leads", order: 2 },
  { key: "clients", label: "Clients", enabled: true, route: "/dashboard/clients", order: 3 },
  { key: "deals", label: "Deals", enabled: true, route: "/dashboard/deals", order: 4 },
  { key: "tasks", label: "Tasks", enabled: true, route: "/dashboard/tasks", order: 5 },
  { key: "meetings", label: "Meetings", enabled: true, route: "/dashboard/meetings", order: 6 },
  { key: "ai_sales", label: "AI Sales", enabled: true, route: "/dashboard/ai-sales", order: 7 },
  { key: "reports", label: "Reports", enabled: true, route: "/dashboard/reports", order: 8 },
  { key: "field_sales", label: "Field Sales", enabled: true, route: "/dashboard/field-sales", order: 9 },
  { key: "integrations", label: "Integrations", enabled: true, route: "/dashboard/integrations", order: 10 },
  { key: "feedback", label: "Feedback", enabled: false, route: "/dashboard/feedback", order: 11 },
];

/** Full permission set for executive / admin roles */
const ALL_PERMS = [...DEFAULT_PERMISSIONS];

/** Standard business roles — dashboards filter by these keys (config-driven, not industry). */
const DEFAULT_ROLES: IndustryTemplateManifest["roles"] = [
  { key: "ceo", label: "CEO", permissions: [...ALL_PERMS] },
  { key: "owner", label: "Owner", permissions: [...ALL_PERMS] },
  { key: "business_admin", label: "Business Admin", permissions: [...ALL_PERMS] },
  { key: "admin", label: "Admin", permissions: [...ALL_PERMS] },
  {
    key: "sales_manager",
    label: "Sales Manager",
    permissions: [
      "contacts.read",
      "contacts.write",
      "deals.read",
      "deals.write",
      "tasks.read",
      "tasks.write",
      "reports.read",
      "reports.export",
      "ai.use",
      "audit.read",
    ],
  },
  {
    key: "manager",
    label: "Manager",
    permissions: [
      "contacts.read",
      "contacts.write",
      "deals.read",
      "deals.write",
      "tasks.read",
      "tasks.write",
      "reports.read",
      "ai.use",
    ],
  },
  {
    key: "sales_executive",
    label: "Sales Executive",
    permissions: [
      "contacts.read",
      "contacts.write",
      "deals.read",
      "deals.write",
      "tasks.read",
      "tasks.write",
      "ai.use",
    ],
  },
  {
    key: "finance",
    label: "Finance",
    permissions: [
      "contacts.read",
      "deals.read",
      "reports.read",
      "reports.export",
      "ai.use",
    ],
  },
  {
    key: "hr",
    label: "HR",
    permissions: ["contacts.read", "tasks.read", "tasks.write", "reports.read", "members.manage"],
  },
  {
    key: "marketing",
    label: "Marketing",
    permissions: [
      "contacts.read",
      "contacts.write",
      "deals.read",
      "reports.read",
      "ai.use",
    ],
  },
  {
    key: "support",
    label: "Support",
    permissions: [
      "contacts.read",
      "contacts.write",
      "tasks.read",
      "tasks.write",
      "ai.use",
    ],
  },
  {
    key: "support_manager",
    label: "Support Manager",
    permissions: [
      "contacts.read",
      "contacts.write",
      "tasks.read",
      "tasks.write",
      "reports.read",
      "deals.read",
      "ai.use",
    ],
  },
  {
    key: "support_executive",
    label: "Support Executive",
    permissions: [
      "contacts.read",
      "contacts.write",
      "tasks.read",
      "tasks.write",
      "ai.use",
    ],
  },
  {
    key: "viewer",
    label: "Viewer",
    permissions: ["contacts.read", "deals.read", "tasks.read", "reports.read"],
  },
];

const CORE_CONTACT_FIELDS: IndustryTemplateManifest["fields"] = [
  {
    key: "name",
    label: "Name",
    entity: "contact",
    type: "text",
    required: true,
    coreMap: "name",
    showInList: true,
    showInForm: true,
    showInFilter: true,
    order: 1,
  },
  {
    key: "phone",
    label: "Phone",
    entity: "contact",
    type: "phone",
    coreMap: "phone",
    showInList: true,
    showInForm: true,
    showInFilter: true,
    order: 2,
  },
  {
    key: "email",
    label: "Email",
    entity: "contact",
    type: "email",
    coreMap: "email",
    showInList: true,
    showInForm: true,
    order: 3,
  },
  {
    key: "company",
    label: "Company",
    entity: "contact",
    type: "text",
    coreMap: "company",
    showInList: true,
    showInForm: true,
    order: 4,
  },
  {
    key: "status",
    label: "Status",
    entity: "contact",
    type: "select",
    coreMap: "status",
    showInList: true,
    showInForm: true,
    showInFilter: true,
    order: 5,
  },
  {
    key: "value",
    label: "Value",
    entity: "contact",
    type: "currency",
    coreMap: "value",
    showInList: false,
    showInForm: true,
    order: 6,
  },
];

const DEFAULT_LEAD_PIPELINE: IndustryTemplateManifest["pipelines"][0] = {
  key: "lead",
  label: "Lead Pipeline",
  entity: "contact",
  statuses: [
    { key: "new", label: "New", color: "#3b82f6", order: 1 },
    { key: "contacted", label: "Contacted", color: "#8b5cf6", order: 2 },
    { key: "qualified", label: "Qualified", color: "#06b6d4", order: 3 },
    { key: "proposal", label: "Proposal Sent", color: "#f59e0b", order: 4 },
    { key: "negotiation", label: "Negotiation", color: "#f97316", order: 5 },
    { key: "won", label: "Won", color: "#22c55e", isWon: true, order: 6 },
    { key: "lost", label: "Lost", color: "#ef4444", isLost: true, order: 7 },
  ],
};

const DEFAULT_DEAL_PIPELINE: IndustryTemplateManifest["pipelines"][0] = {
  key: "deal",
  label: "Deal Pipeline",
  entity: "deal",
  statuses: [
    { key: "lead", label: "Lead", order: 1 },
    { key: "qualified", label: "Qualified", order: 2 },
    { key: "proposal", label: "Proposal", order: 3 },
    { key: "negotiation", label: "Negotiation", order: 4 },
    { key: "closed_won", label: "Closed Won", isWon: true, order: 5 },
    { key: "closed_lost", label: "Closed Lost", isLost: true, order: 6 },
  ],
};

const DEFAULT_AI_FEATURES: IndustryTemplateManifest["aiPromptPack"]["features"] = [
  {
    key: "lead_score",
    label: "Lead Score",
    enabled: true,
    output: "json",
    jsonSchemaHint: '{ "score": 0-100, "explanation": "string" }',
    promptTemplate: `You are a sales analyst for {{businessName}}.
Score this lead 0-100 and explain briefly.
Lead: {{contactName}}, company: {{company}}, status: {{status}}, notes: {{description}}, custom: {{customFields}}.
Return ONLY JSON: { "score": number, "explanation": string }`,
  },
  {
    key: "whatsapp",
    label: "WhatsApp Message",
    enabled: true,
    output: "text",
    ui: { toneOptions: ["Professional", "Friendly", "Urgent"], languages: ["en", "hi", "te"] },
    promptTemplate: `You write WhatsApp follow-ups for {{businessName}}.
Lead: {{contactName}}, phone context notes: {{description}}, custom: {{customFields}}.
Tone: {{tone}}. Language: {{language}}.
Write only the message body, no JSON.`,
  },
  {
    key: "follow_up",
    label: "Follow-up Suggestions",
    enabled: true,
    output: "json",
    promptTemplate: `Suggest 4 follow-up actions for {{businessName}} regarding {{contactName}}.
Context: status={{status}}, notes={{description}}, custom={{customFields}}.
Return ONLY JSON: { "suggestions": string[] }`,
  },
  {
    key: "next_action",
    label: "Next Best Action",
    enabled: true,
    output: "json",
    promptTemplate: `Recommend the single next best action for {{contactName}} at {{businessName}}.
Context: {{description}} {{customFields}}.
Return ONLY JSON: { "action": string, "reason": string, "priority": "low"|"medium"|"high" }`,
  },
];

function defaultImportMappings(): IndustryTemplateManifest["importMappings"] {
  return [
    { sourceHeader: "name", fieldKey: "name" },
    { sourceHeader: "fullname", fieldKey: "name" },
    { sourceHeader: "phone", fieldKey: "phone" },
    { sourceHeader: "mobile", fieldKey: "phone" },
    { sourceHeader: "email", fieldKey: "email" },
    { sourceHeader: "company", fieldKey: "company" },
    { sourceHeader: "status", fieldKey: "status" },
    { sourceHeader: "value", fieldKey: "value" },
  ];
}

function defaultAutomations(): IndustryTemplateManifest["automations"] {
  return [
    {
      key: "lead_created_first_task",
      name: "Create first-call task on lead create",
      enabled: true,
      trigger: { type: "record_created", config: { entity: "contact" } },
      actions: [
        {
          type: "create_task",
          config: { title: "First contact", priority: "medium", dueInDays: 1 },
        },
      ],
    },
    {
      key: "status_changed_notify",
      name: "Notify on status change",
      enabled: false,
      trigger: { type: "status_changed", config: { entity: "contact" } },
      actions: [{ type: "notify", config: { channel: "in_app", title: "Lead status updated" } }],
    },
  ];
}

function defaultNotifications(): IndustryTemplateManifest["notifications"] {
  return [
    {
      key: "lead_created_in_app",
      channel: "in_app",
      event: "record_created",
      template: "New lead: {{name}}",
    },
  ];
}

type Widget = IndustryTemplateManifest["dashboards"][0]["widgets"][number];

function kpi(
  key: string,
  title: string,
  source: Widget["source"],
  layout: Widget["layout"],
  rolesCanView?: string[]
): Widget {
  return {
    key,
    type: "metric_kpi",
    title,
    source,
    layout,
    rolesCanView,
    dateRange: { preset: "all" },
  };
}

function chart(
  key: string,
  title: string,
  chartType: NonNullable<Widget["chartType"]>,
  source: Widget["source"],
  layout: Widget["layout"],
  rolesCanView?: string[]
): Widget {
  return {
    key,
    type: "chart",
    chartType,
    title,
    source,
    layout,
    rolesCanView,
    drillDown: { enabled: true, entity: source.entity, route: "/dashboard/leads" },
    dateRange: { preset: "30d" },
  };
}

/**
 * Role-based default dashboards with chart widgets (config data only).
 * Engines never switch on industry — only widget.type / chartType.
 */
function defaultDashboards(extraWidgets: Widget[] = []): IndustryTemplateManifest["dashboards"] {
  const leadFilter = [{ field: "type", op: "eq" as const, value: "lead" }];
  const openTasks = [{ field: "status", op: "neq" as const, value: "done" }];

  const sharedKpis: Widget[] = [
    kpi(
      "total_leads",
      "Total Leads",
      { entity: "contact", filters: leadFilter, aggregate: "count", dateField: "createdAt" },
      { w: 3, h: 1, x: 0, y: 0 }
    ),
    kpi(
      "pipeline_value",
      "Pipeline Value",
      { entity: "deal", aggregate: "sum", aggregateField: "value", dateField: "createdAt" },
      { w: 3, h: 1, x: 3, y: 0 }
    ),
    kpi(
      "open_tasks",
      "Open Tasks",
      { entity: "task", filters: openTasks, aggregate: "count", dateField: "dueDate" },
      { w: 3, h: 1, x: 6, y: 0 }
    ),
    kpi(
      "win_rate_gauge",
      "Win Rate",
      {
        entity: "contact",
        filters: leadFilter,
        aggregate: "count",
        groupBy: "status",
        dateField: "updatedAt",
      },
      { w: 3, h: 1, x: 9, y: 0 }
    ),
  ];

  const sharedCharts: Widget[] = [
    chart(
      "leads_by_status_bar",
      "Leads by Status",
      "bar",
      {
        entity: "contact",
        filters: leadFilter,
        aggregate: "count",
        groupBy: "status",
        dateField: "createdAt",
      },
      { w: 6, h: 2, x: 0, y: 1 }
    ),
    chart(
      "leads_by_status_pie",
      "Lead Mix",
      "pie",
      {
        entity: "contact",
        filters: leadFilter,
        aggregate: "count",
        groupBy: "status",
        dateField: "createdAt",
      },
      { w: 3, h: 2, x: 6, y: 1 }
    ),
    chart(
      "deals_funnel",
      "Deal Funnel",
      "funnel",
      {
        entity: "deal",
        aggregate: "count",
        groupBy: "stage",
        dateField: "createdAt",
      },
      { w: 3, h: 2, x: 9, y: 1 }
    ),
    chart(
      "leads_trend_line",
      "Leads Over Time",
      "line",
      {
        entity: "contact",
        filters: leadFilter,
        aggregate: "count",
        groupBy: "createdAt_day",
        dateField: "createdAt",
      },
      { w: 6, h: 2, x: 0, y: 3 }
    ),
    chart(
      "pipeline_area",
      "Pipeline Value Trend",
      "area",
      {
        entity: "deal",
        aggregate: "sum",
        aggregateField: "value",
        groupBy: "createdAt_day",
        dateField: "createdAt",
      },
      { w: 6, h: 2, x: 6, y: 3 }
    ),
    chart(
      "status_donut",
      "Status Distribution",
      "donut",
      {
        entity: "contact",
        filters: leadFilter,
        aggregate: "count",
        groupBy: "status",
        dateField: "createdAt",
      },
      { w: 4, h: 2, x: 0, y: 5 }
    ),
    chart(
      "conversion_gauge",
      "Conversion Health",
      "gauge",
      {
        entity: "contact",
        filters: leadFilter,
        aggregate: "count",
        groupBy: "status",
        dateField: "updatedAt",
      },
      { w: 4, h: 2, x: 4, y: 5 }
    ),
    {
      key: "tasks_due_list",
      type: "tasks_due",
      title: "Tasks Due",
      source: { entity: "task", filters: openTasks, aggregate: "count", limit: 10, dateField: "dueDate" },
      layout: { w: 4, h: 2, x: 8, y: 5 },
    },
    ...extraWidgets,
  ];

  return [
    {
      key: "ceo",
      label: "Executive Dashboard",
      description: "Company-wide pipeline, growth, and health",
      roles: ["ceo", "owner"],
      isDefault: true,
      widgets: [
        kpi("ceo_leads", "Total Leads", { entity: "contact", filters: leadFilter, aggregate: "count", dateField: "createdAt" }, { w: 3, h: 1, x: 0, y: 0 }),
        kpi("ceo_clients", "Clients", { entity: "contact", filters: [{ field: "type", op: "eq", value: "client" }], aggregate: "count" }, { w: 3, h: 1, x: 3, y: 0 }),
        kpi("ceo_pipeline", "Pipeline Value", { entity: "deal", aggregate: "sum", aggregateField: "value" }, { w: 3, h: 1, x: 6, y: 0 }),
        kpi("ceo_tasks", "Open Work", { entity: "task", filters: openTasks, aggregate: "count" }, { w: 3, h: 1, x: 9, y: 0 }),
        chart("ceo_funnel", "Revenue Funnel", "funnel", { entity: "deal", aggregate: "sum", aggregateField: "value", groupBy: "stage", dateField: "createdAt" }, { w: 6, h: 2, x: 0, y: 1 }),
        chart("ceo_trend", "Growth Trend", "area", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "createdAt_day", dateField: "createdAt" }, { w: 6, h: 2, x: 6, y: 1 }),
        chart("ceo_status", "Lead Mix", "donut", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "status" }, { w: 4, h: 2, x: 0, y: 3 }),
        chart("ceo_deals_bar", "Deals by Stage", "bar", { entity: "deal", aggregate: "count", groupBy: "stage" }, { w: 4, h: 2, x: 4, y: 3 }),
        chart("ceo_gauge", "Org Health", "gauge", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "status" }, { w: 4, h: 2, x: 8, y: 3 }),
        chart("ceo_pipeline_area", "Pipeline Value Trend", "area", { entity: "deal", aggregate: "sum", aggregateField: "value", groupBy: "createdAt_day" }, { w: 12, h: 2, x: 0, y: 5 }),
      ],
    },
    {
      key: "business_admin",
      label: "Admin Dashboard",
      description: "CRM operations and team activity",
      roles: ["business_admin", "admin"],
      isDefault: true,
      widgets: [
        ...sharedKpis,
        chart("ba_status_bar", "Leads by Status", "bar", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "status" }, { w: 6, h: 2, x: 0, y: 1 }),
        chart("ba_funnel", "Deal Funnel", "funnel", { entity: "deal", aggregate: "count", groupBy: "stage" }, { w: 6, h: 2, x: 6, y: 1 }),
        chart("ba_meetings", "Meetings Load", "line", { entity: "meeting", aggregate: "count", groupBy: "createdAt_day", dateField: "scheduledAt" }, { w: 6, h: 2, x: 0, y: 3 }),
        {
          key: "ba_tasks_due",
          type: "tasks_due",
          title: "Open Tasks",
          source: { entity: "task", filters: openTasks, limit: 8, dateField: "dueDate" },
          layout: { w: 6, h: 2, x: 6, y: 3 },
        },
      ],
    },
    {
      key: "sales_manager",
      label: "Sales Dashboard",
      description: "Team pipeline and forecast analytics",
      roles: ["sales_manager", "manager"],
      isDefault: true,
      widgets: [
        kpi("sm_leads", "All Leads", { entity: "contact", filters: leadFilter, aggregate: "count" }, { w: 3, h: 1, x: 0, y: 0 }),
        kpi("sm_deals", "All Deals", { entity: "deal", aggregate: "count" }, { w: 3, h: 1, x: 3, y: 0 }),
        kpi("sm_value", "Pipeline $", { entity: "deal", aggregate: "sum", aggregateField: "value" }, { w: 3, h: 1, x: 6, y: 0 }),
        kpi("sm_tasks", "Team Tasks", { entity: "task", filters: openTasks, aggregate: "count" }, { w: 3, h: 1, x: 9, y: 0 }),
        chart("sm_bar", "Pipeline by Stage", "bar", { entity: "deal", aggregate: "count", groupBy: "stage" }, { w: 6, h: 2, x: 0, y: 1 }),
        chart("sm_funnel", "Sales Funnel", "funnel", { entity: "deal", aggregate: "count", groupBy: "stage" }, { w: 6, h: 2, x: 6, y: 1 }),
        chart("sm_value_bar", "Value by Stage", "bar", { entity: "deal", aggregate: "sum", aggregateField: "value", groupBy: "stage" }, { w: 6, h: 2, x: 0, y: 3 }),
        chart("sm_leads_line", "Lead Velocity", "line", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "createdAt_day" }, { w: 6, h: 2, x: 6, y: 3 }),
      ],
    },
    {
      key: "sales_executive",
      label: "My Dashboard",
      description: "Personal leads, deals, and follow-ups",
      roles: ["sales_executive"],
      isDefault: true,
      widgets: [
        kpi("se_my_leads", "My Leads", { entity: "contact", filters: leadFilter, aggregate: "count" }, { w: 3, h: 1, x: 0, y: 0 }),
        kpi("se_my_deals", "My Deals", { entity: "deal", aggregate: "count" }, { w: 3, h: 1, x: 3, y: 0 }),
        kpi("se_tasks", "My Tasks", { entity: "task", filters: openTasks, aggregate: "count" }, { w: 3, h: 1, x: 6, y: 0 }),
        kpi("se_meetings", "Meetings", { entity: "meeting", aggregate: "count" }, { w: 3, h: 1, x: 9, y: 0 }),
        chart("se_status", "My Lead Status", "donut", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "status" }, { w: 6, h: 2, x: 0, y: 1 }),
        chart("se_deals", "My Deal Stages", "bar", { entity: "deal", aggregate: "count", groupBy: "stage" }, { w: 6, h: 2, x: 6, y: 1 }),
        {
          key: "se_tasks_list",
          type: "tasks_due",
          title: "My Follow-ups",
          source: { entity: "task", filters: openTasks, limit: 8 },
          layout: { w: 12, h: 2, x: 0, y: 3 },
        },
      ],
    },
    {
      key: "finance",
      label: "Finance Dashboard",
      description: "Revenue, pipeline value, and forecasts",
      roles: ["finance"],
      isDefault: true,
      widgets: [
        kpi("fin_pipeline", "Pipeline Revenue", { entity: "deal", aggregate: "sum", aggregateField: "value" }, { w: 4, h: 1, x: 0, y: 0 }),
        kpi("fin_deals", "Open Deals", { entity: "deal", aggregate: "count" }, { w: 4, h: 1, x: 4, y: 0 }),
        kpi("fin_clients", "Accounts", { entity: "contact", filters: [{ field: "type", op: "eq", value: "client" }], aggregate: "count" }, { w: 4, h: 1, x: 8, y: 0 }),
        chart("fin_value_bar", "Value by Stage", "bar", { entity: "deal", aggregate: "sum", aggregateField: "value", groupBy: "stage" }, { w: 6, h: 2, x: 0, y: 1 }),
        chart("fin_funnel", "Revenue Funnel", "funnel", { entity: "deal", aggregate: "sum", aggregateField: "value", groupBy: "stage" }, { w: 6, h: 2, x: 6, y: 1 }),
        chart("fin_area", "Revenue Trend", "area", { entity: "deal", aggregate: "sum", aggregateField: "value", groupBy: "createdAt_day" }, { w: 12, h: 2, x: 0, y: 3 }),
      ],
    },
    {
      key: "marketing",
      label: "Marketing Dashboard",
      description: "Lead acquisition and campaign performance",
      roles: ["marketing"],
      isDefault: true,
      widgets: [
        kpi("mkt_leads", "Leads", { entity: "contact", filters: leadFilter, aggregate: "count" }, { w: 4, h: 1, x: 0, y: 0 }),
        kpi("mkt_new", "New Status", { entity: "contact", filters: [...leadFilter, { field: "status", op: "eq", value: "new" }], aggregate: "count" }, { w: 4, h: 1, x: 4, y: 0 }),
        kpi("mkt_clients", "Converted Clients", { entity: "contact", filters: [{ field: "type", op: "eq", value: "client" }], aggregate: "count" }, { w: 4, h: 1, x: 8, y: 0 }),
        chart("mkt_pie", "Lead Status Mix", "pie", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "status" }, { w: 6, h: 2, x: 0, y: 1 }),
        chart("mkt_line", "Lead Acquisition", "line", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "createdAt_day" }, { w: 6, h: 2, x: 6, y: 1 }),
        chart("mkt_bar", "Status Breakdown", "bar", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "status" }, { w: 12, h: 2, x: 0, y: 3 }),
      ],
    },
    {
      key: "hr",
      label: "HR Dashboard",
      description: "Team workload and recruitment activity",
      roles: ["hr"],
      isDefault: true,
      widgets: [
        kpi("hr_tasks", "Open Tasks", { entity: "task", filters: openTasks, aggregate: "count" }, { w: 4, h: 1, x: 0, y: 0 }),
        kpi("hr_meetings", "Meetings", { entity: "meeting", aggregate: "count" }, { w: 4, h: 1, x: 4, y: 0 }),
        kpi("hr_leads", "Recruitment Pipeline", { entity: "contact", filters: leadFilter, aggregate: "count" }, { w: 4, h: 1, x: 8, y: 0 }),
        chart("hr_task_donut", "Task Status", "donut", { entity: "task", aggregate: "count", groupBy: "status" }, { w: 6, h: 2, x: 0, y: 1 }),
        {
          key: "hr_task_list",
          type: "list",
          title: "Recent HR Tasks",
          source: { entity: "task", limit: 10 },
          layout: { w: 6, h: 2, x: 6, y: 1 },
        },
      ],
    },
    {
      key: "support",
      label: "Support Dashboard",
      description: "Tickets, customers, and queue health",
      roles: ["support", "support_executive", "support_manager"],
      isDefault: true,
      widgets: [
        kpi("sup_clients", "Clients", { entity: "contact", filters: [{ field: "type", op: "eq", value: "client" }], aggregate: "count" }, { w: 4, h: 1, x: 0, y: 0 }),
        kpi("sup_tickets", "Open Tickets", { entity: "task", filters: openTasks, aggregate: "count" }, { w: 4, h: 1, x: 4, y: 0 }),
        kpi("sup_meetings", "Meetings", { entity: "meeting", aggregate: "count" }, { w: 4, h: 1, x: 8, y: 0 }),
        chart("sup_donut", "Ticket Status", "donut", { entity: "task", aggregate: "count", groupBy: "status" }, { w: 6, h: 2, x: 0, y: 1 }),
        chart("sup_bar", "Task Priority Mix", "bar", { entity: "task", aggregate: "count", groupBy: "status" }, { w: 6, h: 2, x: 6, y: 1 }),
        {
          key: "sup_queue",
          type: "tasks_due",
          title: "Support Queue",
          source: { entity: "task", filters: openTasks, limit: 10 },
          layout: { w: 12, h: 2, x: 0, y: 3 },
        },
      ],
    },
    {
      key: "viewer",
      label: "Viewer Dashboard",
      roles: ["viewer"],
      isDefault: true,
      widgets: [
        kpi("vw_leads", "Leads", { entity: "contact", filters: leadFilter, aggregate: "count" }, { w: 6, h: 1, x: 0, y: 0 }),
        chart("vw_pie", "Status Snapshot", "pie", { entity: "contact", filters: leadFilter, aggregate: "count", groupBy: "status" }, { w: 6, h: 2, x: 0, y: 1 }),
      ],
    },
    {
      key: "main",
      label: "Main Overview",
      description: "Fallback multi-role overview",
      isDefault: false,
      roles: ["viewer"],
      widgets: [...sharedKpis, ...sharedCharts.slice(0, 3)],
    },
  ];
}

export type SeedTemplateMeta = {
  slug: string;
  name: string;
  description: string;
  category: string;
  extraFields?: IndustryTemplateManifest["fields"];
  extraImportMappings?: IndustryTemplateManifest["importMappings"];
  extraAiFeatures?: IndustryTemplateManifest["aiPromptPack"]["features"];
  extraWidgets?: IndustryTemplateManifest["dashboards"][0]["widgets"];
  modulesOverride?: IndustryTemplateManifest["modules"];
  leadStatuses?: IndustryTemplateManifest["pipelines"][0]["statuses"];
};

type PortalDef = NonNullable<IndustryTemplateManifest["portals"]>[number];
type MenuItem = PortalDef["menus"][number];

function menu(
  key: string,
  label: string,
  route: string,
  order: number,
  permissions?: string[]
): MenuItem {
  return { key, label, route, order, enabled: true, permissions };
}

/**
 * Append shared footer menus, skipping any route already present
 * so React keys and sidebar routes stay unique.
 */
function withCommon(menus: MenuItem[]): MenuItem[] {
  const seenRoutes = new Set(menus.map((m) => m.route));
  const footer: MenuItem[] = [
    menu("profile", "Profile", "/dashboard/profile", 90),
    // Appearance is available to every role (no permission gate)
    menu("appearance", "Appearance", "/dashboard/settings/appearance", 91),
    menu("notifications", "Notifications", "/dashboard/activity", 92),
    menu("help", "Help Center", "/dashboard/mentor", 93),
  ];
  const extras = footer.filter((m) => !seenRoutes.has(m.route));
  return [...menus, ...extras];
}

/** Collapse duplicate routes within a portal (keep first / lowest order). */
function uniqueByRoute(menus: MenuItem[]): MenuItem[] {
  const seen = new Set<string>();
  return menus
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((m) => {
      if (seen.has(m.route)) return false;
      seen.add(m.route);
      return true;
    });
}

/**
 * Dedicated portals per role — menus/dashboard/actions from config.
 * Super Admin is platform-level (platformRole); others use business membership role.
 */
function defaultPortals(): PortalDef[] {
  const portals: PortalDef[] = [
    {
      key: "super_admin",
      label: "Super Admin Portal",
      description: "Platform administration",
      roles: ["super_admin"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "main",
      menus: withCommon([
        menu("overview", "Platform Overview", "/dashboard", 1),
        menu("team", "Teams", "/dashboard/team", 2),
        menu("activity", "Audit & Activity", "/dashboard/activity", 3),
        menu("integrations", "Integrations", "/dashboard/integrations", 4),
        menu("reports", "Reports", "/dashboard/reports", 5),
      ]),
      actions: [
        { key: "view_reports", label: "Platform Reports", type: "report", route: "/dashboard/reports", order: 1 },
      ],
      dashboardKeys: ["main", "ceo"],
      reportKeys: ["leads_export"],
    },
    {
      key: "ceo",
      label: "CEO Portal",
      description: "Full company insights, strategy, and executive AI",
      roles: ["ceo", "owner"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "ceo",
      menus: withCommon([
        menu("overview", "Executive Dashboard", "/dashboard", 1),
        menu("leads", "Leads & Pipeline", "/dashboard/leads", 2, ["contacts.read"]),
        menu("clients", "Clients", "/dashboard/clients", 3, ["contacts.read"]),
        menu("deals", "Deals", "/dashboard/deals", 4, ["deals.read"]),
        menu("reports", "Reports", "/dashboard/reports", 5, ["reports.read"]),
        menu("swot", "SWOT Analysis", "/dashboard/swot", 6),
        menu("marketing_ai", "Market AI", "/dashboard/marketing", 7, ["ai.use"]),
        menu("mentor", "AI Mentor", "/dashboard/mentor", 8, ["ai.use"]),
        menu("roadmap", "Growth Roadmap", "/dashboard/roadmap", 9),
        menu("health", "Business Health Score", "/dashboard/health", 10),
        menu("finance", "Finance", "/dashboard/finance", 11, ["reports.read"]),
        menu("ai_sales", "Sales Forecast & AI", "/dashboard/ai-sales", 12, ["ai.use"]),
        menu("team", "Team & Roles", "/dashboard/team", 13, ["members.manage"]),
        menu("field_sales", "Field Sales Map", "/dashboard/field-sales", 14),
        menu("integrations", "Integrations", "/dashboard/integrations", 15, ["config.edit"]),
        menu("profile", "Business Profile", "/dashboard/profile", 16, ["config.edit"]),
        menu("activity", "Activity Logs", "/dashboard/activity", 17, ["audit.read"]),
      ]),
      actions: [
        { key: "exec_reports", label: "View Reports", type: "report", route: "/dashboard/reports", order: 1 },
        { key: "ai_forecast", label: "Sales Forecast", type: "ai_feature", route: "/dashboard/ai-sales", featureKey: "next_action", permission: "ai.use", order: 2 },
        { key: "mentor", label: "AI Mentor", type: "navigate", route: "/dashboard/mentor", permission: "ai.use", order: 3 },
        { key: "field_sales", label: "Field Sales Map", type: "navigate", route: "/dashboard/field-sales", order: 4 },
        { key: "integrations", label: "Integrations", type: "navigate", route: "/dashboard/integrations", permission: "config.edit", order: 5 },
      ],
      dashboardKeys: ["ceo"],
      reportKeys: ["leads_export"],
    },
    {
      key: "business_admin",
      label: "Business Admin Portal",
      description: "CRM operations, team, and business settings",
      roles: ["business_admin", "admin"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "business_admin",
      menus: withCommon([
        menu("overview", "Dashboard", "/dashboard", 1),
        menu("leads", "Leads", "/dashboard/leads", 2, ["contacts.read"]),
        menu("clients", "Clients", "/dashboard/clients", 3, ["contacts.read"]),
        menu("deals", "Deals", "/dashboard/deals", 4, ["deals.read"]),
        menu("tasks", "Tasks", "/dashboard/tasks", 5, ["tasks.read"]),
        menu("meetings", "Meetings", "/dashboard/meetings", 6),
        menu("reports", "Reports", "/dashboard/reports", 7, ["reports.read"]),
        menu("ai_sales", "AI Sales", "/dashboard/ai-sales", 8, ["ai.use"]),
        menu("mentor", "AI Assistant", "/dashboard/mentor", 9, ["ai.use"]),
        menu("team", "Team & Roles", "/dashboard/team", 10, ["members.manage"]),
        menu("field_sales", "Field Sales Map", "/dashboard/field-sales", 11),
        menu("integrations", "Integrations", "/dashboard/integrations", 12, ["config.edit"]),
        menu("profile", "Business Profile", "/dashboard/profile", 13, ["config.edit"]),
        menu("activity", "Activity Logs", "/dashboard/activity", 14, ["audit.read"]),
      ]),
      actions: [
        { key: "new_lead", label: "New Lead", type: "create", route: "/dashboard/leads", permission: "contacts.write", order: 1 },
        { key: "import", label: "Import", type: "navigate", route: "/dashboard/reports", permission: "reports.import", order: 2 },
        { key: "team", label: "Manage Team", type: "navigate", route: "/dashboard/team", permission: "members.manage", order: 3 },
        { key: "ai_tools", label: "AI Sales", type: "ai_feature", route: "/dashboard/ai-sales", featureKey: "lead_score", permission: "ai.use", order: 4 },
        { key: "field_sales", label: "Field Sales Map", type: "navigate", route: "/dashboard/field-sales", order: 5 },
        { key: "integrations", label: "Integrations", type: "navigate", route: "/dashboard/integrations", permission: "config.edit", order: 6 },
      ],
      dashboardKeys: ["business_admin"],
      reportKeys: ["leads_export"],
    },
    {
      key: "sales_manager",
      label: "Sales Manager Portal",
      description: "Sales team, pipeline, and forecast — no CEO-only modules",
      roles: ["sales_manager", "manager"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "sales_manager",
      menus: withCommon([
        menu("overview", "Sales Dashboard", "/dashboard", 1),
        menu("leads", "All Leads", "/dashboard/leads", 2, ["contacts.read"]),
        menu("deals", "All Deals", "/dashboard/deals", 3, ["deals.read"]),
        menu("team", "Sales Team", "/dashboard/team", 4),
        menu("tasks", "Tasks", "/dashboard/tasks", 5, ["tasks.read"]),
        menu("meetings", "Meetings", "/dashboard/meetings", 6),
        menu("reports", "Reports", "/dashboard/reports", 7, ["reports.read"]),
        menu("ai_sales", "AI Sales & Forecast", "/dashboard/ai-sales", 8, ["ai.use"]),
        menu("field_sales", "Team Locations", "/dashboard/field-sales", 9),
      ]),
      actions: [
        { key: "new_lead", label: "New Lead", type: "create", route: "/dashboard/leads", permission: "contacts.write", order: 1 },
        { key: "pipeline", label: "Pipeline", type: "navigate", route: "/dashboard/deals", order: 2 },
        { key: "ai_sales", label: "AI Sales", type: "navigate", route: "/dashboard/ai-sales", permission: "ai.use", order: 3 },
        { key: "field_sales", label: "Team Locations", type: "navigate", route: "/dashboard/field-sales", order: 4 },
      ],
      dashboardKeys: ["sales_manager"],
      reportKeys: ["leads_export"],
    },
    {
      key: "sales_executive",
      label: "Sales Executive Portal",
      description: "Own leads, deals, tasks, meetings, and AI tools only",
      roles: ["sales_executive"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "sales_executive",
      menus: withCommon([
        menu("overview", "My Dashboard", "/dashboard", 1),
        menu("leads", "My Leads", "/dashboard/leads", 2, ["contacts.read"]),
        menu("deals", "My Deals", "/dashboard/deals", 3, ["deals.read"]),
        menu("tasks", "My Tasks", "/dashboard/tasks", 4, ["tasks.read"]),
        menu("meetings", "My Meetings", "/dashboard/meetings", 5),
        menu("field_sales", "My Field Work", "/dashboard/field-sales", 6),
        menu("ai_sales", "WhatsApp AI & Sales Tools", "/dashboard/ai-sales", 7, ["ai.use"]),
        menu("mentor", "AI Assistant", "/dashboard/mentor", 8, ["ai.use"]),
      ]),
      actions: [
        { key: "new_lead", label: "Add Lead", type: "create", route: "/dashboard/leads", permission: "contacts.write", order: 1 },
        { key: "field_start", label: "Field Work", type: "navigate", route: "/dashboard/field-sales", order: 2 },
        { key: "whatsapp", label: "WhatsApp AI", type: "ai_feature", route: "/dashboard/ai-sales", featureKey: "whatsapp", permission: "ai.use", order: 3 },
        { key: "assistant", label: "AI Assistant", type: "navigate", route: "/dashboard/mentor", permission: "ai.use", order: 4 },
      ],
      dashboardKeys: ["sales_executive"],
      reportKeys: [],
    },
    {
      key: "marketing",
      label: "Marketing Portal",
      description: "Campaigns, content, lead sources, and market AI",
      roles: ["marketing"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "marketing",
      menus: withCommon([
        menu("overview", "Marketing Dashboard", "/dashboard", 1),
        menu("marketing_ai", "Market AI & Campaigns", "/dashboard/marketing", 2, ["ai.use"]),
        menu("leads", "Leads", "/dashboard/leads", 3, ["contacts.read"]),
        menu("reports", "Reports", "/dashboard/reports", 4, ["reports.read"]),
      ]),
      actions: [
        { key: "gen_content", label: "Generate Content", type: "navigate", route: "/dashboard/marketing", permission: "ai.use", order: 1 },
        { key: "leads", label: "View Leads", type: "navigate", route: "/dashboard/leads", permission: "contacts.read", order: 2 },
      ],
      dashboardKeys: ["marketing"],
      reportKeys: ["leads_export"],
    },
    {
      key: "support",
      label: "Support Portal",
      description: "Tickets, customers, meetings, and support AI",
      roles: ["support", "support_executive", "support_manager"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "support",
      menus: withCommon([
        menu("overview", "Support Dashboard", "/dashboard", 1),
        menu("tickets", "Support Tickets", "/dashboard/tasks", 2, ["tasks.read"]),
        menu("clients", "Clients", "/dashboard/clients", 3, ["contacts.read"]),
        menu("meetings", "Meetings", "/dashboard/meetings", 4),
        menu("knowledge", "Knowledge Base", "/dashboard/notes", 5),
        menu("mentor", "AI Assistant", "/dashboard/mentor", 6, ["ai.use"]),
      ]),
      actions: [
        { key: "new_ticket", label: "New Ticket", type: "create", route: "/dashboard/tasks", permission: "tasks.write", order: 1 },
        { key: "assistant", label: "AI Assistant", type: "navigate", route: "/dashboard/mentor", permission: "ai.use", order: 2 },
      ],
      dashboardKeys: ["support"],
    },
    {
      key: "hr",
      label: "HR Portal",
      description: "Employees, attendance, recruitment, and HR reports",
      roles: ["hr"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "hr",
      menus: withCommon([
        menu("overview", "HR Dashboard", "/dashboard", 1),
        menu("employees", "Employees", "/dashboard/team", 2),
        menu("activity", "Attendance & Activity", "/dashboard/activity", 3),
        menu("tasks", "Leave & Tasks", "/dashboard/tasks", 4, ["tasks.read"]),
        menu("leads", "Recruitment", "/dashboard/leads", 5, ["contacts.read"]),
        menu("reports", "HR Reports", "/dashboard/reports", 6, ["reports.read"]),
      ]),
      actions: [
        { key: "team", label: "Employees", type: "navigate", route: "/dashboard/team", order: 1 },
      ],
      dashboardKeys: ["hr"],
      reportKeys: ["leads_export"],
    },
    {
      key: "finance",
      label: "Finance Portal",
      description: "Revenue, pipeline value, invoices, and forecasts",
      roles: ["finance"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "finance",
      menus: withCommon([
        menu("overview", "Finance Dashboard", "/dashboard/finance", 1),
        menu("ai_sales", "Revenue Forecast", "/dashboard/ai-sales", 2, ["ai.use"]),
        menu("reports", "Reports", "/dashboard/reports", 3, ["reports.read"]),
      ]),
      actions: [
        { key: "export", label: "Export Reports", type: "report", route: "/dashboard/reports", permission: "reports.export", order: 1 },
        { key: "forecast", label: "Revenue Forecast", type: "navigate", route: "/dashboard/ai-sales", permission: "ai.use", order: 2 },
      ],
      dashboardKeys: ["finance"],
      reportKeys: ["leads_export"],
    },
    {
      key: "viewer",
      label: "Viewer Portal",
      roles: ["viewer"],
      homeRoute: "/dashboard",
      defaultDashboardKey: "viewer",
      menus: withCommon([
        menu("overview", "Overview", "/dashboard", 1),
        menu("leads", "Leads (read-only)", "/dashboard/leads", 2, ["contacts.read"]),
        menu("reports", "Reports", "/dashboard/reports", 3, ["reports.read"]),
      ]),
      actions: [],
      dashboardKeys: ["viewer"],
    },
  ];

  // Guarantee unique routes per portal (and unique menu keys) before seed/sync
  return portals.map((p) => ({
    ...p,
    menus: uniqueByRoute(p.menus || []),
  }));
}

/**
 * Build a full manifest from pure data inputs (no industry branching in engines).
 */
export function buildManifest(meta: SeedTemplateMeta): IndustryTemplateManifest {
  const fields = [...CORE_CONTACT_FIELDS, ...(meta.extraFields || [])].map((f, i) => ({
    ...f,
    order: f.order ?? i + 1,
  }));

  const leadPipeline = {
    ...DEFAULT_LEAD_PIPELINE,
    statuses: meta.leadStatuses || DEFAULT_LEAD_PIPELINE.statuses,
  };

  return {
    schemaVersion: 1,
    slug: meta.slug,
    name: meta.name,
    description: meta.description,
    modules: meta.modulesOverride || DEFAULT_MODULES,
    fields,
    pipelines: [leadPipeline, DEFAULT_DEAL_PIPELINE],
    dashboards: defaultDashboards(meta.extraWidgets),
    reports: [
      {
        key: "leads_export",
        label: "Leads Export",
        entity: "contact",
        columns: fields.filter((f) => f.entity === "contact" && f.showInList).map((f) => f.key),
      },
    ],
    automations: defaultAutomations(),
    notifications: defaultNotifications(),
    aiPromptPack: {
      systemContext: `You assist {{businessName}} (industry label: {{industryLabel}}). Use custom field data: {{customFields}}.`,
      features: [...DEFAULT_AI_FEATURES, ...(meta.extraAiFeatures || [])],
    },
    roles: DEFAULT_ROLES,
    importMappings: [...defaultImportMappings(), ...(meta.extraImportMappings || [])],
    portals: defaultPortals(),
    feedback: {
      enabled: false,
      fields: [
        { key: "rating", label: "Rating", type: "rating", required: true },
        { key: "nps", label: "NPS", type: "nps" },
        { key: "comment", label: "Comment", type: "textarea" },
      ],
    },
    whiteLabelDefaults: {
      appTitle: meta.name,
    },
  };
}
