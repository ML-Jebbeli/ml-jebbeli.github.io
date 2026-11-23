# Repository Agent Instructions — Frontend

This repository is the public GitHub Pages frontend: ML-Jebbeli/ml-jebbeli.github.io. Its main branch publishes https://ml-jebbeli.github.io/.

Before work:
1. Read docs/chat-ux-knowledge.fa.md.
2. Run git status, git fetch origin and inspect the latest origin/main.
3. Preserve existing user changes; never force-push or overwrite unrelated work.

## Scope
- Work only on the website frontend and its UI documentation.
- Main files: index.html, course-chat.css and course-chat.js.
- Keep the existing Cloudflare Worker endpoint, JSON contract, Origin allowlist, input/history limits, timeout and error behavior unchanged unless the owner explicitly requests a backend/API change.
- Do not edit the private backend repository from this task. Do not change GLM, system prompts, RAG, quotas, Durable Objects, Cloudflare secrets or production configuration.
- Do not alter unrelated site sections, CTA, resources, certificates, identity-card assets, mobile menu or Telegram floating button.
- Keep Persian RTL, dark/light themes, keyboard/IME behavior, accessibility and reduced-motion support.
- Suggestion chips only fill the input; they must not send a request or consume quota.
- Render model/user text safely with DOM APIs; never inject untrusted text through innerHTML.

## Owner's existing publication instruction
The owner previously authorized direct commits and git push to main for frontend UI work only. This does not authorize backend changes, Worker deployments or Cloudflare configuration changes. If the owner gives a newer instruction, follow the newer instruction.

## Acceptance and reporting
Test dark/light and responsive behavior at 320, 390, 768 and 1440 CSS px where tools permit. Check launch/close, first question, long answers, links/code, 429/503/network errors, Persian IME, keyboard focus, reduced motion, safe-area/virtual keyboard, and no horizontal overflow or collision with the mobile menu and #floatTg.

Never fabricate screenshots. Report code changes, tests, commit SHA, GitHub push, Pages deployment and live-site observation as separate facts. If a check was not possible, report NOT_EXECUTED.
