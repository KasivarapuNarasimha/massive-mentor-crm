# Lead ↔ Deal ↔ Client Pipeline Sync

**Service:** `apps/api/src/services/pipeline-sync.service.ts`  
**Wired into:** `updateContact`, `bulkEditLeads`, `updateDeal` in `crm.service.ts`

## Rules

| Lead status | Deal stage | Side effects |
|-------------|------------|--------------|
| new / contacted | lead | — |
| qualified | qualified | Auto-create deal if none (default on) |
| proposal | proposal | Auto-create if none |
| negotiation | negotiation | Auto-create if none |
| **won** | **closed_won** | Convert lead → **client** (`status: active`); notify deal_won |
| **lost** | **closed_lost** | Notify deal_lost |

| Deal stage | Contact |
|------------|---------|
| closed_won / won | type client, status active |
| closed_lost / lost | status lost |
| qualified / proposal / negotiation | matching lead status |

## Settings (`Business.settings.pipelineSync`)

```json
{
  "pipelineSync": {
    "autoCreateDeal": true,
    "convertLeadToClientOnWon": true,
    "protectClosedDeals": true
  }
}
```

- **autoCreateDeal** — if false and no deal exists, API returns `promptCreateDeal: true` (UI toast).
- **protectClosedDeals** — do not regress closed_won/closed_lost on mid-pipeline lead edits.

## API response

`PUT /api/crm/contacts/:id` and `PUT /api/crm/deals/:id` include:

```json
{
  "success": true,
  "data": {
    "contact": { "...": "..." },
    "pipelineSync": {
      "dealsUpdated": 1,
      "dealCreated": false,
      "dealIds": ["..."],
      "contactConvertedToClient": true,
      "contactStatusSynced": false,
      "promptCreateDeal": false,
      "messages": ["..."]
    }
  }
}
```

## UI refresh

Lead/Deal mutations emit `emitDataChanged({ module: "all" })` so:

- Overview ConfigDashboard (`useDataVersion`)
- Reports KPIs
- AI Sales lists / insights data
- Notification bell
- Deals kanban (also emits on drag-drop)

## Single source of truth

Do **not** re-implement status→stage maps in the UI. All sync logic lives in `pipeline-sync.service.ts`.
