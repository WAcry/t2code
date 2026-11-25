# Context in portable handoffs

T3 Code transfers conversation context when you switch providers, continue through a portable
restart, or use a fork that the provider cannot resume itself.

Short conversations transfer intact. For longer conversations, T3 Code favors recent requests and
answers, the original request, and relevant activity such as command outcomes. Selected messages
keep their full text, order, and user or assistant role, including partial work from failed or
interrupted turns. Your new request stays separate and is never shortened to make history fit.

Codex receives historical messages directly when its installed version supports that operation.
Other providers receive the same selection as attributed conversation context. A handoff does not
copy the outgoing provider's reasoning, tool-call state, or attachments.

The handoff includes references to omitted history. The agent can use T3 Code's thread-reading tool
to retrieve saved messages and activity, including the remainder of a long item. For an important
constraint, you can still repeat it in your next message. A handoff is a budgeted selection, not an
agent-written summary.

## Context limits

A handoff must leave room for existing provider context, your request and attachments, instructions,
tools, and subsequent work. If the target conversation has no room for the handoff, T3 Code starts
a fresh provider conversation with a bounded selection of saved history and sends your request
automatically. You do not need to compact manually. If the request and attachments leave too little
room even in a fresh conversation, shorten the request or select a larger-context model. T3 Code
never shortens your request to make it fit.

Recovery leaves running background work intact. Let it finish or stop it before retrying the handoff.

The default history allowance is 160,000 estimated tokens, equivalent to 640,000 UTF-16 code
units. To change it, set `T3CODE_CONTEXT_HANDOFF_TOKEN_CAP` on the server to a token count between
1,024 and 250,000. The maximum is equivalent to 1,000,000 UTF-16 code units. Attribution,
separators and JSON escaping count toward the allowance.

T3 Code uses available capacity information for your selected model and options, together with
provider context telemetry. Starting a fresh provider conversation clears prior usage, while keeping
known model capacity. When you change models or context-window options in the same native
conversation, its existing messages still consume space.

When no capacity information is available, T3 Code assumes a 272,000-token window. It reserves
one quarter for instructions, tools and subsequent work, with a minimum of 16,000 tokens and a
maximum of half the window. It also deducts the current request and 8,192 estimated tokens per
image or 4,096 per other attachment. Known smaller windows and provider compaction thresholds
still constrain the handoff.

T3 Code estimates one token per four UTF-16 code units in text. It uses the same estimate for
saved activity when native usage telemetry is unavailable. The provider's own tokenizer may
count more tokens, particularly for some languages and code, and can reject an input that fits
the estimate.
