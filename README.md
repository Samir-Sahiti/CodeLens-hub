# CodeLens

CodeLens is a developer productivity tool that helps engineers understand large and unfamiliar codebases quickly.

Instead of manually searching through dozens of files, CodeLens indexes a repository and allows developers to ask natural language questions about the code. The system analyzes project structure, files, and commit history to return relevant explanations and code references.

The goal of CodeLens is to make onboarding, code exploration, and architectural understanding significantly faster for developers.

---

## Problem

Developers frequently join new projects or work with large codebases where understanding how things work takes hours or days. Finding the right files, tracing logic across modules, and understanding architectural decisions can be slow and frustrating.

Existing tools focus mostly on keyword search or static documentation, which often becomes outdated or incomplete.

---

## Solution

CodeLens analyzes a repository and builds an internal index of its structure. Developers can then query the codebase using natural language and receive explanations, summaries, and links to relevant parts of the code.

Example questions:

- "How does authentication work?"
- "Where is the payment logic implemented?"
- "What changed in the checkout system recently?"
- "Which files interact with the database?"

---

## Key Features

### Repository Indexing
Upload or connect a repository and automatically analyze its structure, files, and relationships.

### Natural Language Code Search
Ask questions about the codebase and receive contextual answers with references to relevant files.

### Pull Request Summaries
Generate short explanations of pull requests or commit diffs to quickly understand what changed.

### Project Onboarding Guide
Automatically generate a high-level overview of a repository's architecture and important components.

### Contextual Code Navigation
Jump directly to relevant files and sections instead of manually browsing the project.

---

## Tech Stack

### Frontend
- Next.js
- React
- TailwindCSS

### Backend
- ASP.NET Core Web API

### Data & Infrastructure
- PostgreSQL
- Vector database for code embeddings
- Docker

### AI Components
- Code embeddings for semantic search
- Natural language query processing
- Automated summarization

---

## Project Structure
