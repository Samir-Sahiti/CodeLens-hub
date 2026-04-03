# CodeLens

**CodeLens** is a codebase intelligence platform that helps developers understand large and unfamiliar repositories quickly. Instead of manually tracing through hundreds of files, CodeLens indexes a repository, maps its structure, and lets developers ask natural language questions, visualize dependencies, and simulate the blast radius of a change — before making it.

---

## Problem

When developers join a new team or work with an unfamiliar codebase, they spend days — sometimes weeks — manually tracing through hundreds of files just to understand how things connect. There is no efficient way to get a structural overview of a project, identify which files are risky to change, or understand the downstream impact of a modification before making it.

Existing tools like GitHub and IDEs offer file browsers and search, but they are passive — they show you files, they do not explain relationships, flag risk, or answer questions about the system as a whole. Developers are left to build a mental model of the codebase manually, every single time.

---

## Solution

CodeLens analyzes a repository and gives developers an immediate, structured understanding of how the system is built. A developer connects a GitHub repository or uploads a project, and CodeLens indexes the entire codebase — mapping files, functions, dependencies, and relationships into a navigable knowledge layer.

Rather than replacing the developer's judgment, CodeLens augments it. It surfaces what matters: which files are critical, which are risky, what breaks if something changes, and where structural problems are hiding.

---

## Key Features

### 1. Codebase Structure Mapping — Interactive Dependency Graph
Analyzes the repository and builds a visual, interactive dependency graph. Nodes represent files and modules, edges show how they relate. Developers can explore the architecture visually and understand the system at a glance rather than reading through files sequentially.

### 2. Architectural Issue Detection
Automatically detects structural problems including circular dependencies, tightly coupled modules, oversized god files, and potentially dead or unused code. Risk areas are highlighted directly on the graph so developers can prioritise what to address.

### 3. File Impact & Complexity Analysis
Presents each file's metrics in a clear table: number of dependencies, how many other files depend on it, and complexity indicators. This helps developers immediately identify critical files (high usage), risky files (high complexity + high usage), and low-value or unused files.

### 4. Change Impact Analysis
Before making a modification, a developer can select any file and see its blast radius — exactly which other parts of the system would be affected. This prevents unintended side effects and gives developers confidence when working in unfamiliar areas of the codebase.

### 5. Intelligent Code Search
A natural language search interface powered by a RAG (Retrieval-Augmented Generation) architecture. The codebase is chunked and indexed semantically, so queries like "How does authentication work?" or "Where is the payment logic?" return context-aware explanations with direct links to relevant code — not just keyword matches.

---

## Target Users

- **Software Developers** — working with large, complex, or unfamiliar codebases on a daily basis
- **Engineering Teams & Tech Leads** — reviewing changes, onboarding new members, and maintaining architectural quality
- **Software Architects** — analyzing dependencies, planning refactors, and identifying structural risk across a system

---

## Tech Stack

### Frontend
- **Framework**: React 18, built with Vite for optimal HMR and lightning-fast builds
- **Styling**: Tailwind CSS for a modern, utility-first design system
- **Visualisation**: D3.js (Force-Directed Graph) for interactive, physics-based dependency plotting
- **Routing**: React Router DOM

### Backend
- **Environment**: Node.js + Express.js handling REST API layers and async indexing pipelines
- **Code Parsing**: Tree-sitter for robust, cross-language Abstract Syntax Tree (AST) generation. Currently supports JavaScript, TypeScript, TSX, Python, and C#.
- **Version Control API**: GitHub REST API (Octokit) for securely pulling repository file trees and raw source code

### Database & Authentication
- **Operational DB**: Supabase (PostgreSQL) storing indexed repo metadata, nodes, edges, and issues
- **Authentication**: Supabase Auth handling secure sign-ins and JWT session management
- **Vector Storage**: `pgvector` extension for storing and performing similarity searches on code embeddings

### AI Integration (RAG Pipeline)
- **Embeddings**: OpenAI API (`text-embedding-3-small` or equivalent) to generate semantic vectors for code chunks
- **LLM Reasoning**: Anthropic Claude API / OpenAI GPT-4 to explain code structures and answer natural language queries based on retrieved context

### Infrastructure
- **Containerisation**: Docker & Docker Compose for reproducible local environments and streamlined service execution

---

## Project Structure

```
codelens/
├── frontend/               # React + D3.js client
│   ├── public/
│   └── src/
│       ├── components/     # Reusable UI components
│       │   ├── graph/      # D3.js dependency graph components
│       │   ├── search/     # Natural language search UI
│       │   └── ui/         # General UI primitives
│       ├── pages/          # Top-level route pages
│       ├── hooks/          # Custom React hooks
│       ├── utils/          # Helper functions
│       └── lib/            # API client, Supabase client
│
├── backend/                # Node.js + Express API
│   └── src/
│       ├── routes/         # Express route definitions
│       ├── controllers/    # Request handlers
│       ├── services/       # Core business logic
│       ├── parsers/        # Tree-sitter AST parsing per language
│       ├── ai/             # RAG pipeline, Claude API integration
│       ├── db/             # Supabase queries and schema helpers
│       └── middleware/     # Auth, error handling, validation
│
├── docs/                   # Project documentation
├── scripts/                # Dev and utility scripts
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Development Roadmap

The project follows an Agile methodology across five two-week sprints.

| Sprint | Weeks | Focus | Goal |
|--------|-------|-------|------|
| 1 | 1–2 | Foundation | Project setup, Supabase config, GitHub API integration, basic file upload. User can connect a repo and have it indexed. |
| 2 | 3–4 | Core Analysis Engine | Tree-sitter AST parsing, dependency extraction, graph data model. System produces a structured dependency map. |
| 3 | 5–6 | Visualisation & Metrics | D3.js interactive graph, complexity metrics table, architectural issue detection. Developers can visually explore the codebase and see flagged risk areas. |
| 4 | 7–8 | AI Layer & Impact Analysis | RAG pipeline, natural language search interface, change impact analysis. Developers can ask questions and simulate blast radius. |
| 5 | 9–10 | Polish & Stabilisation | UI refinement, performance optimisation, bug fixing, stress-testing the RAG pipeline. Demo-ready product. |

---

## Getting Started

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Docker Desktop** — for running the local Postgres instance
- **Git Bash / WSL / macOS/Linux terminal** — to run `setup.sh`
- **Supabase project** — create one free at [supabase.com](https://supabase.com)
- **GitHub OAuth App** — register at GitHub → Settings → Developer settings → OAuth Apps
- **Anthropic API key** — for Claude code search (Sprint 4)
- **OpenAI API key** — for embedding generation (`text-embedding-3-small`)

### One-time database setup

Before running the app, apply the database migration:

1. In your Supabase dashboard go to **Database → Extensions** and enable **`vector`** (pgvector)
2. Open **SQL Editor → New query**, paste the contents of [`scripts/001_initial_schema.sql`](scripts/001_initial_schema.sql), and click **Run**

### Local setup

```bash
# Clone the repository
git clone https://github.com/your-org/codelens-hub.git
cd codelens-hub

# Bootstrap — installs deps and copies .env.example → .env (idempotent)
bash scripts/setup.sh

# Fill in your credentials in .env
# Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#           VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
#           GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
#           ANTHROPIC_API_KEY, OPENAI_API_KEY

# Start local Postgres
docker-compose up -d

# In terminal 1 — start the Express API (localhost:3001)
cd backend && npm run dev

# In terminal 2 — start the Vite dev server (localhost:3000)
cd frontend && npm run dev
```

The frontend proxies all `/api/*` and `/auth/*` requests to the backend automatically — no CORS configuration needed in development.

---

## Team

- Leutrim Istrefi
- Rinor Abazi
- Samir Sahiti
