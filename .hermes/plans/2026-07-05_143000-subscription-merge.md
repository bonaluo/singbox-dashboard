# Subscription Merge / Aggregation Plan

**Goal:** Allow creating aggregated subscriptions that merge nodes from multiple existing subscriptions (plus optional extra URLs).

**Changes:**

### Model (`models/models.go`)
Add `Aggregated bool` and `Sources []string` to `Subscription`.

### Backend (`services/subscription.go`)
- `CreateMergedSubscription(name string, sourceIDs []string, extraURL string)`: Create a merged sub record and fetch+parse all sources
- `GetMergedNodeData(id string)`: Load all children's cached data, merge + dedup nodes
- Modify `ApplySubscription()`: For aggregated subs, use `GetMergedNodeData()` instead of loading a single cache file
- `AddSubscription()` already exists — reused for extra URL

### Backend (`handlers/handlers.go`)
- `POST /api/subscriptions/merge` — `{name, sources: ["id1","id2"], extra_url?: "..."}`

### Frontend (`app/subscriptions/page.tsx`)
- Add "创建聚合订阅" button/modal
- Show checkbox list of existing subs
- Optional extra URL input
- Preview merged node count
- Submit creates aggregated subscription via API

### Frontend detail view
- For aggregated subs, show which sources they come from
