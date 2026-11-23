# Jebbeli AI Assistant — Website Frontend

Public website: https://ml-jebbeli.github.io/

This repository contains the static GitHub Pages frontend for the Jebbeli machine-learning course website and its Persian RTL chat interface.

## Start here

- Coding-agent rules: [AGENTS.md](AGENTS.md)
- Chat UI/UX knowledge and acceptance criteria: [docs/chat-ux-knowledge.fa.md](docs/chat-ux-knowledge.fa.md)

## Main files

- index.html — website structure and chat widget markup
- course-chat.css — chat widget styling
- course-chat.js — frontend chat behavior and Worker request client
- ax.png / ax.jpg — existing brand assets

## Architecture boundary

The chat UI calls a separately hosted Cloudflare Worker and expects the existing JSON response contract. This repository is not the backend. Do not change the Worker, model, system prompt, RAG, quota, Cloudflare secrets or API behavior as part of a frontend-only task.

For backend changes, use the separately authorized private repository and its own AGENTS.md instructions.

## Development

Preserve Persian RTL, dark/light themes, mobile responsiveness, keyboard/IME behavior, accessibility, safe DOM rendering, current endpoint, error handling and existing site navigation. See the UX knowledge document before editing.
