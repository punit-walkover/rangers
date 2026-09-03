import { TelegramIcon, DiscordIcon, WhatsappIcon, SlackIcon, SmsIcon, VoiceIcon } from "./ChannelIcons";

/**
 * Ranger swatches.
 *
 * Stored as hex and applied via inline `style` on purpose: Tailwind's purge only
 * safelists the `bg-(red|green|yellow|orange|gray)-500` and `trace-*` patterns
 * (see tailwind.config.js), so dynamically-built colour classes would be stripped
 * from the production build.
 */
export const RANGER_COLORS = [
  { key: "red", label: "Red", callsign: "Crimson", hex: "#E03131" },
  { key: "blue", label: "Blue", callsign: "Cobalt", hex: "#1C7ED6" },
  { key: "green", label: "Green", callsign: "Jade", hex: "#2F9E44" },
  { key: "purple", label: "Purple", callsign: "Violet", hex: "#7048E8" },
  { key: "pink", label: "Pink", callsign: "Rose", hex: "#D6336C" },
  { key: "yellow", label: "Yellow", callsign: "Ember", hex: "#F2540B" },
  { key: "black", label: "Slate", callsign: "Slate", hex: "#495057" },
];

/** Swatch hex -> callsign, so a card can name a ranger by its colour. */
export const CALLSIGN_BY_HEX = RANGER_COLORS.reduce((acc, color) => {
  acc[color.hex] = color.callsign;
  return acc;
}, {});

export const DEFAULT_RANGER_COLOR = RANGER_COLORS[5].hex;

// Fixed folder every Ranger is filed into; mirrors gtwy-node/gtwy-ai's RANGER_FOLDER_ID, which gates memory.
export const RANGER_FOLDER_ID = process.env.NEXT_PUBLIC_RANGER_FOLDER_ID || "6a759880bb5238a667057e72";

/**
 * Channels shown in the Command Center and the wizard's channel step.
 *
 * Only telegram and discord are actually implemented (app/api/telegram/setup,
 * app/api/discord/setup). The rest are rendered as "Coming soon" and cannot be
 * toggled on.
 */
export const RANGER_CHANNELS = [
  {
    key: "telegram",
    label: "Telegram",
    icon: TelegramIcon,
    brand: "#229ED9",
    enabled: true,
    setupEndpoint: "/api/telegram/setup",
    blurb: "Bot chats and group replies via @BotFather.",
    credentialFields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "123456:ABC-DEF...",
        secret: true,
        hint: "Create a bot with @BotFather and paste the full token here.",
      },
    ],
    // Mirrors the check in components/modals/TelegramConnectModal.js
    validate: (creds) => {
      const token = (creds?.botToken || "").trim();
      if (!token) return "Bot token is required.";
      if (!token.includes(":")) return "Invalid token format. Paste the full token from @BotFather.";
      return "";
    },
  },
  {
    key: "discord",
    label: "Discord",
    icon: DiscordIcon,
    brand: "#5865F2",
    enabled: true,
    setupEndpoint: "/api/discord/setup",
    blurb: "Direct messages and server commands.",
    credentialFields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "MTIzNDU2...",
        secret: true,
        hint: "From the Discord Developer Portal → your app → Bot → Reset Token.",
      },
    ],
    // Mirrors the check in components/modals/DiscordConnectModal.js
    validate: (creds) => {
      const token = (creds?.botToken || "").trim();
      if (!token) return "Bot token is required.";
      if (token.length < 50) return "Invalid token. Paste the full bot token from the Developer Portal.";
      return "";
    },
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: WhatsappIcon,
    brand: "#25D366",
    enabled: false,
    blurb: "Business messaging.",
  },
  { key: "slack", label: "Slack", icon: SlackIcon, brand: "#E01E5A", enabled: false, blurb: "Channel and DM replies." },
  { key: "sms", label: "SMS", icon: SmsIcon, brand: "#7C3AED", enabled: false, blurb: "Text messaging." },
  { key: "voice", label: "Voice", icon: VoiceIcon, brand: "#F2540B", enabled: false, blurb: "Inbound call handling." },
];

export const CONNECTABLE_CHANNELS = RANGER_CHANNELS.filter((channel) => channel.enabled);

/**
 * Creativity presets. The concrete number is derived at render time from the
 * selected model's `additional_parameters.temperature` {min, max, default},
 * because the usable range differs per model (0–1 vs 0–2).
 */
export const CREATIVITY_LEVELS = [
  {
    key: "precise",
    label: "Precise",
    description: "Consistent and factual. Best for support and policy answers.",
    t: 0,
  },
  { key: "balanced", label: "Balanced", description: "A sensible middle ground for most conversations.", t: 0.5 },
  { key: "creative", label: "Creative", description: "More varied phrasing. Good for copy and ideation.", t: 0.7 },
];

export const DEFAULT_CREATIVITY = "balanced";

/**
 * Where Balanced lands: the model's declared default, else mid-range. A default
 * sitting on the ceiling is ignored — Creative has to stay above Balanced, and
 * nothing is above the maximum.
 */
const balancedTemperature = (min, max, tempParam) => {
  const declared = Number(tempParam.default);
  if (Number.isFinite(declared) && declared >= min && declared < max) return declared;
  return Number((min + 0.5 * (max - min)).toFixed(2));
};

/**
 * Resolves a creativity preset to a concrete temperature for the given model
 * parameter spec. Returns null when the model does not expose temperature — in
 * that case the key must be omitted from the payload entirely, since an
 * unsupported parameter can fail the provider call.
 *
 * Creative is derived from Balanced rather than from a fixed fraction of the
 * range. A flat fraction collides with the declared default on common specs —
 * a 0–1 model declaring 0.7 made Balanced and Creative send the identical
 * number — so it sits partway between Balanced and the top of the range, and
 * is always strictly above Balanced unless Balanced is already at the ceiling.
 */
export const resolveTemperature = (levelKey, tempParam) => {
  if (!tempParam) return null;
  const min = Number(tempParam.min ?? 0);
  const max = Number(tempParam.max ?? 1);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  const level = CREATIVITY_LEVELS.find((item) => item.key === levelKey) || CREATIVITY_LEVELS[1];
  if (level.key === "precise") return min;

  const balanced = balancedTemperature(min, max, tempParam);
  if (level.key === "balanced") return balanced;

  return Number((balanced + 0.5 * (max - balanced)).toFixed(2));
};

/**
 * Tone presets. Single source of truth — also consumed by
 * components/configuration/configurationComponent/ToneDropdown.js.
 */
export const TONES = [
  { value: "authoritative", prompt: "Generate a strong, commanding response with authoritative guidance." },
  { value: "casual", prompt: "Generate a response in a relaxed, easygoing, and informal tone." },
  { value: "confident", prompt: "Generate a direct and assertive response with a confident tone." },
  { value: "concise", prompt: "Generate a brief, straight-to-the-point response." },
  { value: "curious", prompt: "Generate an inquisitive response showing curiosity." },
  { value: "empathetic", prompt: "Generate a response showing understanding, concern, and support." },
  { value: "friendly", prompt: "Generate a warm and welcoming response with a friendly tone." },
  {
    value: "formal",
    prompt: "Generate a response in a professional, respectful, and clear tone suitable for official communication.",
  },
  { value: "humorous", prompt: "Generate a playful and light-hearted response with humor." },
  {
    value: "inspiring",
    prompt: "Generate a response that uplifts and inspires the reader toward a higher purpose or goal.",
  },
  { value: "motivational", prompt: "Generate an encouraging and uplifting response." },
  { value: "neutral", prompt: "Generate an objective and balanced response without emotional engagement." },
  { value: "polite", prompt: "Generate a respectful and courteous response." },
  { value: "sarcastic", prompt: "Generate a witty and ironic response with a touch of sarcasm." },
];

/**
 * Starter system prompts, shown as chips on the wizard's Prompt step.
 *
 * These are posting rangers: something arrives on a connected channel
 * (Telegram, Discord) and the ranger writes the content and publishes it with
 * the account's posting tool. `blurb` is the chip tooltip; `{{name}}` is
 * replaced with the ranger's name when the template is applied.
 */
export const PROMPT_TEMPLATES = [
  {
    key: "Instagram Reels",
    blurb: "Turns a Telegram message into a reel script + caption and posts it.",
    prompt: `You are {{name}}, an Instagram content ranger.

You are triggered by a message on a connected channel (usually Telegram). That message is the brief: a topic, a link, a rough idea or a voice note transcript.

Your job:
- Turn the brief into a 20-40 second reel script: hook in the first line, three beats, one clear payoff
- Write the caption: two short lines, one call to action, 3-5 relevant hashtags
- Post it immediately with the Instagram posting tool, then reply on the trigger channel with the live link

Rules:
- Do not ask for confirmation. If the brief is clear, write and post in one turn
- Ask exactly one question only when the brief is too thin to write from
- Never invent product claims, prices, dates or customer names that are not in the brief
- Never use more than one emoji per line, and never post the same hook twice in a week
- If the posting tool fails, reply on the trigger channel with the full draft and the error`,
  },
  {
    key: "LinkedIn Posts",
    blurb: "Drafts and publishes a LinkedIn post when triggered from any channel.",
    prompt: `You are {{name}}, a LinkedIn posting ranger.

Any connected channel can trigger you — Telegram, Discord, or a scheduled digest. The incoming message is the brief.

Your job:
- Write a LinkedIn post: one-line hook, 3-5 short paragraphs, a concrete number or example, a closing question
- Keep it under 1,200 characters and under three hashtags
- Publish it with the LinkedIn posting tool, then reply on the trigger channel with the live link

Rules:
- Post directly. No confirmation round-trip unless the brief mentions a customer, a hiring decision or unreleased news — those get drafted and sent back for approval instead
- Plain professional English. No "thrilled to announce", no hustle platitudes, no fake vulnerability
- Never state metrics, funding or headcount that were not in the brief
- If the posting tool fails, return the draft in full on the trigger channel`,
  },
  {
    key: "X Threads",
    blurb: "Expands an idea or link into a thread and posts it.",
    prompt: `You are {{name}}, an X (Twitter) posting ranger.

You are triggered by a message on a connected channel containing a topic, a link or a paragraph to break down.

Your job:
- Write a 4-7 post thread: post 1 is the hook and stands alone, each following post carries one idea, the last one closes with a takeaway or link
- Keep every post under 270 characters so it never gets clipped
- Publish the thread with the posting tool, then reply on the trigger channel with the link to post 1

Rules:
- Post directly, no confirmation step
- No hashtags. At most one emoji in the whole thread
- Never quote a statistic or a person without the source being in the brief
- Do not engage with replies or quote-tweets unless the brief asks you to`,
  },
  {
    key: "Cross-Post",
    blurb: "One idea, reshaped per platform, posted everywhere at once.",
    prompt: `You are {{name}}, a cross-posting ranger.

One brief arrives on a connected channel. You publish it to every platform the account has connected, rewritten for each one — never the same text pasted around.

Your job:
- Instagram: reel script plus caption, 3-5 hashtags
- LinkedIn: hook, short paragraphs, closing question, under 1,200 characters
- X: 4-7 post thread, each post under 270 characters
- Post each one with its platform tool, then reply on the trigger channel with one line per platform: platform, status, link

Rules:
- Post directly to every platform in one pass. Do not wait for approval between platforms
- Keep the claim identical across platforms; only the shape and length change
- If one platform fails, still post the rest, and report exactly which failed and why
- Never invent facts to fill a longer format — a shorter post is fine`,
  },
  {
    key: "Comment & DM Triage",
    blurb: "Answers comments and DMs, escalates anything sensitive.",
    prompt: `You are {{name}}, a social inbox ranger.

You receive comments and direct messages from the connected social accounts and answer them in the account's voice.

Your job:
- Answer product, pricing-range and "how does it work" questions from the knowledge base
- Reply to praise briefly and warmly; reply to criticism with an acknowledgement and a next step
- Hide or report spam, scams and targeted harassment
- Post a daily digest to the trigger channel: volume, themes, anything you escalated

Rules:
- Never argue in public. Two replies maximum per thread, then move it to DMs or a human
- Never share account data, order details or anything personal in a public comment
- Escalate legal threats, press enquiries, outage reports and safety issues to a human at once, unanswered
- If you are not sure a reply is on-message, send it to the trigger channel instead of posting it`,
  },
  {
    key: "Blank",
    blurb: "Start from scratch.",
    prompt: `You are {{name}}.

Your job:
-

Rules:
- `,
  },
];

/** Chip key -> template, for applying a template by key. */
export const getPromptTemplate = (key) => PROMPT_TEMPLATES.find((template) => template.key === key);

/**
 * The create-agent response returns `configuration.prompt` as a structured
 * object rather than a string. Keys mirror the backend exactly — `instruction`
 * is singular there even though it reads as "Instructions" in the UI.
 */
export const PROMPT_PART_FIELDS = [
  { key: "role", label: "Role" },
  { key: "goal", label: "Goal" },
  { key: "instruction", label: "Instructions" },
];

/** Structured prompt object -> {role, goal, instruction}, or null when it isn't one. */
export const parsePromptParts = (prompt) => {
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return null;
  const hasAnyPart = PROMPT_PART_FIELDS.some(({ key }) => typeof prompt[key] === "string" && prompt[key].trim());
  if (!hasAnyPart) return null;

  return PROMPT_PART_FIELDS.reduce((acc, { key }) => {
    acc[key] = typeof prompt[key] === "string" ? prompt[key] : "";
    return acc;
  }, {});
};

/** Flattens the parts into the single string used for validation and preview. */
export const combinePromptParts = (parts) => {
  if (!parts) return "";
  return PROMPT_PART_FIELDS.map(({ key, label }) => {
    const value = (parts[key] || "").trim();
    return value ? `${label}:\n${value}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
};

export const GUIDED_STEPS = [
  { key: "identity", label: "Identity" },
  { key: "channels", label: "Channels" },
  { key: "model", label: "Model" },
  { key: "prompt", label: "Prompt" },
  { key: "connectors", label: "Connectors" },
  { key: "review", label: "Review" },
];

/** AI mode is just a chat (AiBuildChatPanel) that maps into the same form Review/Publish uses. */
export const AI_STEPS = [
  { key: "chat", label: "Chat" },
  { key: "review", label: "Review" },
];

export const DEPLOY_PHASES = {
  IDLE: "idle",
  CREATING: "creating",
  HYDRATING: "hydrating",
  CONFIGURING: "configuring",
  CHANNELS: "channels",
  PUBLISHING: "publishing",
  DONE: "done",
  FAILED: "failed",
};

export const DEPLOY_PHASE_LABELS = {
  [DEPLOY_PHASES.CREATING]: "Creating the ranger",
  [DEPLOY_PHASES.HYDRATING]: "Loading its version",
  [DEPLOY_PHASES.CONFIGURING]: "Applying prompt, model and tone",
  [DEPLOY_PHASES.CHANNELS]: "Binding channels",
  [DEPLOY_PHASES.PUBLISHING]: "Publishing",
};
