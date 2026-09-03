"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, MessagesSquare } from "lucide-react";
import { SparklesIcon, BotIcon, LinkIcon } from "@/components/Icons";
import Modal from "@/components/UI/Modal";
import { MODAL_TYPE } from "@/utils/enums";
import { openModal } from "@/utils/utility";
import { CONNECTABLE_CHANNELS } from "@/components/rangers/rangerConstants";
import { useConfigurationContext } from "../ConfigurationContext";
import PromptTab from "./PromptTab";
import ModelTab from "./ModelTab";
import ConnectorsTab from "./ConnectorsTab";
import ChannelsPanel from "./ChannelsPanel";

const MODAL_WIDTH = "w-[min(1040px,95vw)]";
/** These panels are tall, so the scrollbar has to be visible to hint at it. */
const MODAL_BODY = "scrollbar-visible";

const SetupRow = ({ icon: Icon, title, summary, modalId, testId, configured }) => (
  <button
    type="button"
    data-testid={testId}
    data-configured={configured ? "true" : "false"}
    onClick={() => openModal(modalId)}
    className="flex w-full items-center gap-3 rounded-[13px] border border-line bg-card px-4 py-3 text-left transition-colors duration-200 hover:bg-paper"
  >
    <span className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-line bg-base-200">
      <Icon className="h-4 w-4 text-base-content" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-base-content">{title}</span>
      <span className="mt-0.5 block truncate text-xs text-soft">{summary}</span>
    </span>
    <span
      className={`flex-none rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        configured ? "bg-success/15 text-success" : "bg-base-300 text-soft"
      }`}
    >
      {configured ? "Done" : "Set up"}
    </span>
    <ChevronRight size={16} className="flex-none text-soft" />
  </button>
);

/** A prompt counts as written whether it is a plain string or a section object. */
const hasPromptContent = (value) => {
  if (!value) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object") return Object.values(value).some((v) => typeof v === "string" && v.trim() !== "");
  return false;
};

/** Channel bindings live behind /api/channel-details, not in the bridge document. */
const useConnectedChannels = (versionId) => {
  const [connected, setConnected] = useState([]);

  useEffect(() => {
    if (!versionId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/channel-details?version_id=${encodeURIComponent(versionId)}`);
        const data = await res.json();
        if (cancelled || !data?.success) return;
        setConnected(CONNECTABLE_CHANNELS.filter((channel) => data.data?.[channel.key]?.botToken).map((c) => c.label));
      } catch (err) {
        console.error("Loading channel details failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [versionId]);

  return connected;
};

/**
 * Ranger setup is one row per area; the options live in modals so the page stays
 * a short list instead of four stacked panels.
 *
 * No "Memory" row here — ranger/user memory is always on server-side, no per-Ranger toggle.
 */
const RangerSetupSections = () => {
  const { isPublished, isEmbedUser, service, modelName, bridge_functions, reduxPrompt, searchParams } =
    useConfigurationContext();
  const connectedChannels = useConnectedChannels(searchParams?.version);

  const modelSummary = useMemo(() => {
    const parts = [service, modelName].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Pick a service provider and model.";
  }, [service, modelName]);

  const connectorSummary = useMemo(() => {
    const count = bridge_functions?.length || 0;
    if (!count) return "No tools attached yet.";
    return `${count} tool${count > 1 ? "s" : ""} attached`;
  }, [bridge_functions]);

  const channelSummary = connectedChannels.length
    ? `${connectedChannels.join(" · ")} connected`
    : "Telegram, Discord, and custom triggers.";

  const rows = useMemo(
    () => [
      {
        key: "prompt",
        icon: SparklesIcon,
        title: "Prompt",
        summary: "Role, goal, and instructions for this ranger.",
        modalId: MODAL_TYPE.RANGER_PROMPT_MODAL,
        configured: hasPromptContent(reduxPrompt),
      },
      {
        key: "model",
        icon: BotIcon,
        title: "LLM Configuration",
        summary: modelSummary,
        modalId: MODAL_TYPE.RANGER_MODEL_MODAL,
        configured: Boolean(service && modelName),
      },
      {
        key: "connectors",
        icon: LinkIcon,
        title: "Connectors",
        summary: connectorSummary,
        modalId: MODAL_TYPE.RANGER_CONNECTORS_MODAL,
        configured: (bridge_functions?.length || 0) > 0,
      },
      {
        key: "channels",
        icon: MessagesSquare,
        title: "Channels",
        summary: channelSummary,
        modalId: MODAL_TYPE.RANGER_CHANNELS_MODAL,
        configured: connectedChannels.length > 0,
      },
    ],
    [
      reduxPrompt,
      modelSummary,
      service,
      modelName,
      connectorSummary,
      bridge_functions,
      channelSummary,
      connectedChannels,
    ]
  );

  const configuredCount = rows.filter((row) => row.configured).length;

  return (
    <div data-testid="ranger-setup-sections" className="flex flex-col gap-2">
      <div data-testid="ranger-setup-progress" className="pb-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-base-content">Agent setup</h2>
          <span className="text-xs text-soft">
            {configuredCount} of {rows.length} configured
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-base-300">
          <span
            className="block h-full rounded-full bg-success transition-all duration-300"
            style={{ width: `${(configuredCount / rows.length) * 100}%` }}
          />
        </div>
      </div>

      {rows.map((row) => (
        <SetupRow
          key={row.key}
          icon={row.icon}
          title={row.title}
          summary={row.summary}
          modalId={row.modalId}
          testId={`ranger-setup-row-${row.key}`}
          configured={row.configured}
        />
      ))}

      <Modal
        MODAL_ID={MODAL_TYPE.RANGER_PROMPT_MODAL}
        title="Prompt"
        description="Define the agent's role, behavior, and instructions."
        icon={<SparklesIcon className="h-4 w-4 text-base-content" />}
        widthClass={MODAL_WIDTH}
        bodyClassName={MODAL_BODY}
      >
        <PromptTab isPublished={isPublished} isEmbedUser={isEmbedUser} />
      </Modal>

      <Modal
        MODAL_ID={MODAL_TYPE.RANGER_MODEL_MODAL}
        title="LLM Configuration"
        description="Service provider, model, and generation parameters."
        icon={<BotIcon className="h-4 w-4 text-base-content" />}
        widthClass={MODAL_WIDTH}
        bodyClassName={MODAL_BODY}
      >
        <ModelTab isPublished={isPublished} />
      </Modal>

      <Modal
        MODAL_ID={MODAL_TYPE.RANGER_CONNECTORS_MODAL}
        title="Connectors"
        description="Create tools and connect authenticated organization services."
        icon={<LinkIcon className="h-4 w-4 text-base-content" />}
        widthClass={MODAL_WIDTH}
        bodyClassName={MODAL_BODY}
      >
        <ConnectorsTab isPublished={isPublished} />
      </Modal>

      <Modal
        MODAL_ID={MODAL_TYPE.RANGER_CHANNELS_MODAL}
        title="Channels"
        description="Connect Telegram, Discord, or a custom trigger to this ranger."
        icon={<MessagesSquare size={16} className="text-base-content" />}
        widthClass={MODAL_WIDTH}
        bodyClassName={MODAL_BODY}
      >
        <ChannelsPanel />
      </Modal>
    </div>
  );
};

export default RangerSetupSections;
