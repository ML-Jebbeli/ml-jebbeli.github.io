import { renderAnswer } from "./course-chat-render.js?v=5";
import { copyText } from "./site-ui.js?v=5";

export function createTranscript({ container, avatarTemplate, copyRoot, canCopy, retryTurn }) {
  const exchanges = [];

  function createExchange(turn) {
    const question = turn.user.content;
    const element = document.createElement("div");
    element.className = "course-chat-exchange";
    const prompt = document.createElement("p");
    prompt.className = "course-chat-message course-chat-message-user";
    prompt.dir = "auto";
    prompt.textContent = question;
    const response = document.createElement("div");
    response.className = "course-chat-result";
    element.append(prompt, response);
    return { question, element, response, turn };
  }

  function copyControl(label, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "course-chat-text-button";
    button.textContent = label;
    let feedback;
    button.addEventListener("click", async () => {
      const success = await copyText(text, copyRoot);
      if (!button.isConnected || !canCopy()) return;
      const result = success ? "کپی شد" : "کپی نشد؛ متن را انتخاب کن.";
      button.textContent = result;
      clearTimeout(feedback);
      feedback = setTimeout(() => { button.textContent = label; }, 2600);
    });
    return button;
  }

  function showAnswer(exchange, text) {
    const answer = document.createElement("div");
    answer.className = "course-chat-answer";
    const bubble = document.createElement("div");
    bubble.className = "course-chat-message";
    bubble.dir = "auto";
    renderAnswer(bubble, text, copyControl);
    const avatar = avatarTemplate.cloneNode(true);
    avatar.classList.add("course-chat-avatar");
    const copy = copyControl("کپی پاسخ", text);
    copy.classList.add("course-chat-copy");
    answer.append(bubble, avatar);
    exchange.response.replaceChildren(answer, copy);
    exchange.answer = text;
  }

  function showFailure(exchange, text) {
    const state = document.createElement("div");
    state.className = "course-chat-failure";
    const note = document.createElement("p");
    note.textContent = text;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "course-chat-text-button";
    retry.textContent = "تلاش دوباره";
    retry.addEventListener("click", () => retryTurn(exchange.turn));
    exchange.retry = retry;
    state.append(note, retry);
    exchange.response.replaceChildren(state);
  }

  function update(turns, session) {
    const old = new Map(exchanges.map(exchange => [exchange.turn.id, exchange]));
    let changed = turns.length !== exchanges.length;
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const exchange = old.get(turn.id) ?? createExchange(turn);
      old.delete(turn.id);
      if (exchange !== exchanges[i]) changed = true;
      exchanges[i] = exchange;
      exchange.turn = turn;
      const answer = turn.assistant?.content;
      const failure = session.failure(turn);
      if (answer && exchange.answer !== answer) {
        showAnswer(exchange, answer);
        exchange.retry = undefined;
        changed = true;
      } else if (failure !== exchange.failure) {
        exchange.failure = failure;
        if (!answer) {
          if (failure) showFailure(exchange, failure);
          else {
            exchange.retry = undefined;
            exchange.response.replaceChildren();
          }
          changed = true;
        }
      }
    }
    for (const exchange of old.values()) exchange.element.remove();
    exchanges.length = turns.length;
    exchanges.forEach(({ element }, index) => {
      if (container.children[index] !== element) container.insertBefore(element, container.children[index] ?? null);
    });
    for (const { retry, turn } of exchanges) {
      if (retry) retry.disabled = !session.canRetry(turn);
    }
    return changed;
  }

  function clear() {
    container.replaceChildren();
    exchanges.length = 0;
  }

  return { exchanges, update, clear };
}
