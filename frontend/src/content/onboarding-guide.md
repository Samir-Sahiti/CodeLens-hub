---
slug: connecting-a-repo
title: Connecting a repo
tryItTab: files
tryItLabel: Connect or upload
annotations:
  - { x: 24, y: 28, label: "GitHub OAuth" }
  - { x: 70, y: 55, label: "ZIP upload" }
---
Connect a GitHub repository with OAuth or upload a ZIP when you want a quick local scan. CodeLens indexes files, dependencies, metrics, issues, and search chunks into one workspace so the rest of the app can answer questions against the same repository model.

---
slug: dependency-graph
title: The dependency graph
tryItTab: graph
tryItLabel: Open Graph
annotations:
  - { x: 42, y: 18, label: "Blast radius toggle" }
  - { x: 71, y: 55, label: "Cluster expand" }
---
The graph maps imports and relationships with a force layout, clustering, blast radius analysis, and attack-surface overlays. Use it to spot central files, understand what a change may affect, and move from a system-level view into a specific file.

---
slug: issues-panel
title: Issues panel
tryItTab: issues
tryItLabel: Review Issues
annotations:
  - { x: 31, y: 30, label: "Issue type filters" }
  - { x: 78, y: 22, label: "Generate fix" }
---
The Issues panel groups architectural findings, secrets, suppressions, and security concerns so triage stays focused. Risk sorting becomes richer once US-078 ships, and eligible findings can flow into generated fix proposals for faster review.

---
slug: metrics-tab
title: Metrics tab
tryItTab: metrics
tryItLabel: Open Metrics
annotations:
  - { x: 33, y: 42, label: "Complexity" }
  - { x: 64, y: 42, label: "Churn" }
---
Metrics summarizes complexity, churn, line counts, and file-level signals. It is a compact place to find hotspots before opening individual files or graph relationships.

---
slug: dependencies-tab
title: Dependencies tab
tryItTab: dependencies
tryItLabel: Check Dependencies
annotations:
  - { x: 28, y: 35, label: "Vulnerable packages" }
  - { x: 73, y: 62, label: "Fix proposals" }
---
Dependencies shows software composition analysis for package manifests and vulnerable libraries. Batched fix proposals arrive with US-083, but the tab already gives you the inventory and vulnerability context needed for dependency cleanup.

---
slug: tours
title: Tours
tryItTab: tours
tryItLabel: Open Tours
annotations:
  - { x: 24, y: 25, label: "Create" }
  - { x: 54, y: 55, label: "Fork and share" }
---
Tours let you create guided walkthroughs over graph nodes and repository concepts, then fork or share them with teammates. They are useful for onboarding people to unfamiliar code paths without writing a separate document.

---
slug: pull-requests-tab
title: Pull Requests tab
tryItTab: pulls
tryItLabel: View PRs
annotations:
  - { x: 50, y: 48, label: "Coming soon" }
---
Coming soon — PR review integration is shipping in a future update. This tab is reserved for pull request context, review signals, and repository changes once the integration lands.

---
slug: agent-search-tab
title: Agent / Search tab
tryItTab: agent
tryItLabel: Ask the Agent
annotations:
  - { x: 39, y: 70, label: "Ask a question" }
  - { x: 68, y: 32, label: "Tool-backed answers" }
---
Agent / Search helps you ask repository questions grounded in indexed code and analysis data. Current search behavior focuses on code-aware retrieval; this copy swaps to fuller agent guidance when US-069 ships.

---
slug: settings
title: Settings
tryItTab: settings
tryItLabel: Open Settings
annotations:
  - { x: 30, y: 34, label: "Webhook auto-sync" }
  - { x: 70, y: 63, label: "Team and CI settings" }
---
Settings contains repository operations such as webhook auto-sync, team membership, notification preferences, and CI integration. Use it when you need to control how CodeLens stays current and who can collaborate on a repo.
