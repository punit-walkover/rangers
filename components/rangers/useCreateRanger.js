"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import {
  createBridgeWithAiAction,
  getAllBridgesAction,
  getBridgeVersionAction,
  updateBridgeAction,
  updateBridgeVersionAction,
  publishBridgeVersionAction,
} from "@/store/action/bridgeAction";
import {
  CONNECTABLE_CHANNELS,
  DEPLOY_PHASES,
  RANGER_FOLDER_ID,
  TONES,
  combinePromptParts,
  parsePromptParts,
  resolveTemperature,
} from "./rangerConstants";
import { buildRangerMeta, mergeRangerMeta } from "./rangerMeta";

/** Falls back to a plain string when the response prompt is not the structured object. */
const resolvePromptText = (prompt) => {
  if (!prompt) return "";
  if (typeof prompt === "string") return prompt.trim();
  if (typeof prompt !== "object") return "";

  const candidate = prompt.prompt ?? prompt.system_prompt ?? prompt.content ?? prompt.text ?? "";
  return typeof candidate === "string" ? candidate.trim() : "";
};

/**
 * The create call can come back with a backend-generated name (it does when a
 * `purpose` is sent, which is what drafts the prompt). The name the user typed
 * is the one they expect to see, so it is written back when they differ.
 * Non-fatal: a failure here leaves the generated name, not a broken agent.
 */
const useRestoreName = (dispatch) =>
  useCallback(
    async (agent, typedName) => {
      const wanted = (typedName || "").trim();
      if (!agent?._id || !wanted || agent.name === wanted) return;
      try {
        await dispatch(updateBridgeAction({ bridgeId: agent._id, dataToSend: { name: wanted } }));
      } catch (err) {
        console.error("Restoring the ranger name failed", err);
      }
    },
    [dispatch]
  );

/**
 * Orchestrates ranger creation end to end.
 *
 * Phase order matters:
 *   create → hydrate → configure → channels → publish → refresh
 *
 * The hydrate phase is NOT optional. `createBridgeAction` opens by dispatching
 * `clearPreviousBridgeDataReducer()`, which empties `bridgeVersionMapping`, and
 * both `updateBridgeVersionAction` (store/action/bridgeAction.js:554) and
 * `publishBrigeVersionReducer` (store/reducer/bridgeReducer.js:292) index two
 * levels into that map with no optional chaining. Without an explicit
 * `getBridgeVersionAction` in between, the next phase throws.
 */
const useCreateRanger = ({ orgId, onDeployed }) => {
  const dispatch = useDispatch();
  const restoreName = useRestoreName(dispatch);
  const [phase, setPhase] = useState(DEPLOY_PHASES.IDLE);
  const [error, setError] = useState("");
  const [channelWarnings, setChannelWarnings] = useState([]);
  const [toolWarnings, setToolWarnings] = useState([]);
  const [created, setCreated] = useState(null);
  const [connectedChannels, setConnectedChannels] = useState({});
  const [connectedTools, setConnectedTools] = useState({});
  // Tracks Identity's background create separately from `phase`, which stays reserved for the Review/deploy pipeline.
  const [identityPhase, setIdentityPhase] = useState(DEPLOY_PHASES.IDLE);
  const [identityError, setIdentityError] = useState("");

  // Survives retries so a second Deploy click never creates a second agent.
  const createdRef = useRef(null);
  const connectedChannelsRef = useRef({});
  const connectedToolsRef = useRef({});
  const hydratedVersionRef = useRef(null);
  const mountedRef = useRef(true);
  // In-flight createFromIdentity promise, so a second call reattaches instead of creating a duplicate agent.
  const creatingPromiseRef = useRef(null);
  /**
   * Bumped by reset(). An async run started before a reset finishes long after
   * the user has abandoned it; without this it would write its agent id back
   * into createdRef and repopulate `created`, so the next Deploy would publish
   * the discarded agent.
   */
  const runIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSet = useCallback((setter, value) => {
    if (mountedRef.current) setter(value);
  }, []);

  /** True while the run that captured `runId` is still the current one. */
  const isCurrentRun = useCallback((runId) => mountedRef.current && runIdRef.current === runId, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    createdRef.current = null;
    connectedChannelsRef.current = {};
    connectedToolsRef.current = {};
    hydratedVersionRef.current = null;
    creatingPromiseRef.current = null;
    setCreated(null);
    setConnectedChannels({});
    setConnectedTools({});
    setPhase(DEPLOY_PHASES.IDLE);
    setError("");
    setChannelWarnings([]);
    setToolWarnings([]);
    setIdentityPhase(DEPLOY_PHASES.IDLE);
    setIdentityError("");
  }, []);

  /** Phase 2 — create. Always sends flag:true; description becomes purpose when present. */
  const runCreate = useCallback(
    async (form) => {
      const ranger = buildRangerMeta(form);
      const description = form.description.trim();
      const dataToSend = {
        // Create must be "api" — the backend rejects "trigger" here. It is
        // promoted right after the agent exists (see promoteToTrigger).
        bridgeType: "api",
        name: form.name.trim(),
        flag: true,
        meta: { ranger },
        folder_id: RANGER_FOLDER_ID, // always the fixed Rangers folder, not the ambient browsing folder
        ...(description ? { purpose: description } : {}),
      };

      // Without purpose the backend still needs a concrete model to create against.
      if (!description) {
        dataToSend.service = form.service;
        dataToSend.model = form.model;
        dataToSend.type = form.modelGroup || "chat";
      }

      // flag:true → synchronous HTTP create (see createBridgeWithAiAction).
      const response = await dispatch(createBridgeWithAiAction({ dataToSend, orgId }));
      const agent = response?.data?.agent;
      const rawPrompt = response?.data?.prompt ?? agent?.configuration?.prompt;
      const promptParts = parsePromptParts(rawPrompt);

      return {
        agent,
        promptParts,
        prompt: promptParts ? combinePromptParts(promptParts) : resolvePromptText(rawPrompt),
      };
    },
    [dispatch, orgId]
  );

  /**
   * Rangers run as triggers, but creation only accepts "api" — so flip the type
   * once the agent exists. Non-fatal: the ranger still works as an API agent.
   */
  const promoteToTrigger = useCallback(
    async (agentId) => {
      try {
        await dispatch(updateBridgeAction({ bridgeId: agentId, dataToSend: { bridgeType: "trigger" } }));
      } catch (err) {
        console.error("Failed to switch the ranger to a trigger agent", err);
      }
    },
    [dispatch]
  );

  /**
   * Creates the agent as soon as Identity is submitted (any mode).
   * The created ref is shared with deploy(), so publishing later never creates
   * a second agent.
   */
  const createFromIdentity = useCallback(
    async (form) => {
      if (createdRef.current?.agentId) {
        return { success: true, ...createdRef.current };
      }
      // Already in flight — await the same request instead of firing a duplicate.
      if (creatingPromiseRef.current) {
        return creatingPromiseRef.current;
      }

      safeSet(setIdentityError, "");
      safeSet(setIdentityPhase, DEPLOY_PHASES.CREATING);

      const runId = runIdRef.current;
      const promise = (async () => {
        try {
          const { agent, prompt, promptParts } = await runCreate(form);
          if (!agent?._id) throw new Error("Agent creation did not return an agent.");

          const versionId = agent.versions?.[0];
          if (!versionId) throw new Error("Agent was created without a version.");

          const createdAgent = {
            agentId: agent._id,
            versionId,
            service: agent.service,
            meta: agent?.meta,
          };

          // Creating with a `purpose` lets the backend name the agent itself,
          // which throws away the name the user typed. Put theirs back.
          await restoreName(agent, form.name);
          if (!isCurrentRun(runId)) return { success: false, message: "Cancelled." };
          createdRef.current = createdAgent;
          safeSet(setCreated, { agentId: agent._id, versionId, name: form.name.trim() });

          // Backend may drop `meta` on create; make sure the ranger data lands.
          if (!agent?.meta?.ranger) {
            try {
              await dispatch(
                updateBridgeAction({
                  bridgeId: agent._id,
                  dataToSend: { meta: mergeRangerMeta(agent?.meta, form) },
                })
              );
            } catch (metaError) {
              console.error("Failed to persist ranger meta", metaError);
            }
          }

          await promoteToTrigger(agent._id);

          if (!isCurrentRun(runId)) return { success: false, message: "Cancelled." };
          safeSet(setIdentityPhase, DEPLOY_PHASES.IDLE);
          return { success: true, ...createdAgent, prompt, promptParts };
        } catch (err) {
          console.error("Ranger identity creation failed", err);
          const message = err?.response?.data?.message || err?.message || "Something went wrong while creating.";
          if (!isCurrentRun(runId)) return { success: false, message: "Cancelled." };
          safeSet(setIdentityPhase, DEPLOY_PHASES.FAILED);
          safeSet(setIdentityError, message);
          return { success: false, message };
        }
      })();

      creatingPromiseRef.current = promise;
      try {
        return await promise;
      } finally {
        creatingPromiseRef.current = null;
      }
    },
    [dispatch, isCurrentRun, promoteToTrigger, restoreName, runCreate, safeSet]
  );

  /** Phase 4 — one consolidated version update, never three concurrent ones. */
  const runConfigure = useCallback(
    async (form, { agentId, versionId, createdService }) => {
      const tone = form.tone ? TONES.find((item) => item.value === form.tone) : null;
      const temperature = resolveTemperature(form.creativity, form.temperatureParam);

      const dataToSend = {
        ...(form.service && form.service !== createdService ? { service: form.service } : {}),
        // Binds the version to the org API key for its own service, so the
        // ranger runs on the user's quota instead of silently falling back.
        // Same shape ApiKeyModal writes. Omitted when there is no key.
        ...(form.apikeyObjectId && Object.keys(form.apikeyObjectId).length
          ? { apikey_object_id: form.apikeyObjectId }
          : {}),
        // Knowledge bases picked before the version existed. Same doc_ids shape
        // KnowledgebaseList writes on the configure page.
        ...(Array.isArray(form.docIds) && form.docIds.length ? { doc_ids: form.docIds } : {}),
        configuration: {
          // Preserve the backend's structured shape when the prompt came back
          // as {role, goal, instruction}; templates fall back to a string.
          prompt: form.promptParts || form.prompt,
          model: form.model,
          ...(form.modelGroup ? { type: form.modelGroup } : {}),
          // Omitted entirely when the model does not expose temperature —
          // an unsupported parameter can fail the provider call.
          ...(temperature !== null ? { temperature } : {}),
          // Same shape McpServerList saves. Collected before the version
          // exists, so it is written here rather than as it is typed.
          ...(Array.isArray(form.mcpServers) && form.mcpServers.length
            ? { mcp_config: { servers: form.mcpServers } }
            : {}),
        },
        ...(tone ? { settings: { tone: { value: tone.value, prompt: tone.prompt } } } : {}),
      };

      await dispatch(updateBridgeVersionAction({ bridgeId: agentId, versionId, dataToSend }));
    },
    [dispatch]
  );

  /**
   * Phase 5 — channel binding. Sequential, not parallel: both setup routes
   * upsert the SAME `channel_details` document keyed by version_id, so
   * concurrent upserts can race the insert (the route handles 11000, but the
   * loser's write is lost). Failures here are non-fatal.
   * Channels already connected from the Channels step are skipped.
   */
  const runChannels = useCallback(
    async (form, { agentId, versionId }) => {
      const warnings = [];
      for (const channel of CONNECTABLE_CHANNELS) {
        if (!form.channels?.[channel.key]?.enabled) continue;
        if (connectedChannelsRef.current[channel.key]) continue;
        const creds = form.channels[channel.key].credentials || {};
        // No credential means the user chose not to connect this one. Skip it
        // silently rather than calling the setup route with an empty token and
        // reporting the rejection back as a warning they never asked for.
        if (!(creds.botToken || "").trim()) continue;
        try {
          const res = await fetch(channel.setupEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              botToken: (creds.botToken || "").trim(),
              version_id: versionId,
              agent_id: agentId,
              org_id: orgId,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.success) {
            warnings.push({ channel: channel.label, message: data?.error || "Failed to connect." });
            continue;
          }
          connectedChannelsRef.current[channel.key] = true;
          // Soft warnings: the token saved but the runtime hookup did not complete.
          if (data?.webhook && !data.webhook.registered && data.webhook.message) {
            warnings.push({ channel: channel.label, message: data.webhook.message });
          }
          if (data?.gateway && data.gateway.message && data.gateway.connected === false) {
            warnings.push({ channel: channel.label, message: data.gateway.message });
          }
        } catch (err) {
          warnings.push({ channel: channel.label, message: err?.message || "Failed to connect." });
        }
      }
      return warnings;
    },
    [orgId]
  );

  /**
   * Attaches tools chosen before the agent existed. Sequential, and non-fatal
   * like channels: a tool that fails to attach is reported as a warning rather
   * than sinking a deploy that has already published everything else.
   * Tools already attached from the Connectors step are skipped.
   */
  const runTools = useCallback(
    async (form, { agentId, versionId }) => {
      const toolIds = Array.isArray(form.toolIds) ? form.toolIds : [];
      const warnings = [];
      for (const functionId of toolIds) {
        if (!functionId || connectedToolsRef.current[functionId]) continue;
        try {
          await dispatch(
            updateBridgeVersionAction({
              bridgeId: agentId,
              versionId,
              dataToSend: { functionData: { function_id: functionId, function_operation: "1" } },
            })
          );
          connectedToolsRef.current[functionId] = true;
        } catch (err) {
          console.error("Attaching the tool failed", err);
          warnings.push({
            tool: functionId,
            message: err?.response?.data?.message || err?.message || "Failed to attach.",
          });
        }
      }
      if (Object.keys(connectedToolsRef.current).length) {
        safeSet(setConnectedTools, { ...connectedToolsRef.current });
      }
      return warnings;
    },
    [dispatch, safeSet]
  );

  /**
   * Connect a single channel from the Channels step once Identity has created
   * the agent (version_id is required by telegram/discord setup routes).
   */
  const connectChannel = useCallback(
    async (channelKey, credentials = {}) => {
      const channel = CONNECTABLE_CHANNELS.find((item) => item.key === channelKey);
      if (!channel) return { success: false, message: "Unknown channel." };

      const agentId = createdRef.current?.agentId;
      const versionId = createdRef.current?.versionId;
      if (!agentId || !versionId) {
        return { success: false, message: "Create the ranger on Identity before connecting channels." };
      }

      const message = channel.validate?.(credentials);
      if (message) return { success: false, message };

      try {
        const res = await fetch(channel.setupEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botToken: (credentials.botToken || "").trim(),
            version_id: versionId,
            agent_id: agentId,
            org_id: orgId,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          return { success: false, message: data?.error || `Failed to connect ${channel.label}.` };
        }

        connectedChannelsRef.current[channelKey] = true;
        safeSet(setConnectedChannels, { ...connectedChannelsRef.current });

        if (data?.webhook && !data.webhook.registered && data.webhook.message) {
          toast.warning(`${channel.label}: ${data.webhook.message}`);
        }
        if (data?.gateway && data.gateway.message && data.gateway.connected === false) {
          toast.warning(`${channel.label}: ${data.gateway.message}`);
        }

        toast.success(`${channel.label} connected.`);
        return { success: true };
      } catch (err) {
        return { success: false, message: err?.message || `Failed to connect ${channel.label}.` };
      }
    },
    [orgId, safeSet]
  );

  /**
   * `updateBridgeVersionAction` reads two levels into `bridgeVersionMapping`
   * with no optional chaining, so any mid-wizard version write has to hydrate
   * the version first.
   */
  const ensureHydratedVersion = useCallback(
    async (versionId) => {
      if (hydratedVersionRef.current === versionId) return;
      const hydrated = await dispatch(getBridgeVersionAction({ versionId }));
      if (!hydrated?._id) throw new Error("Could not load the ranger's version.");
      hydratedVersionRef.current = versionId;
    },
    [dispatch]
  );

  /** Attach an authenticated organization tool to the version created on Identity. */
  const connectTool = useCallback(
    async (functionId) => {
      if (!functionId) return { success: false, message: "Unknown tool." };
      if (connectedToolsRef.current[functionId]) return { success: true };

      const agentId = createdRef.current?.agentId;
      const versionId = createdRef.current?.versionId;
      if (!agentId || !versionId) {
        return { success: false, message: "Create the ranger on Identity before connecting tools." };
      }

      try {
        await ensureHydratedVersion(versionId);

        await dispatch(
          updateBridgeVersionAction({
            bridgeId: agentId,
            versionId,
            dataToSend: { functionData: { function_id: functionId, function_operation: "1" } },
          })
        );

        connectedToolsRef.current[functionId] = true;
        safeSet(setConnectedTools, { ...connectedToolsRef.current });
        return { success: true };
      } catch (err) {
        console.error("Connecting the tool failed", err);
        return { success: false, message: err?.response?.data?.message || err?.message || "Failed to connect." };
      }
    },
    [dispatch, ensureHydratedVersion, safeSet]
  );

  /**
   * Persist the tone the moment it is picked, in the same shape ToneDropdown
   * writes (`settings.tone`), so the wizard and the configure page agree.
   * Before the agent exists the form still carries it into the deploy update.
   */
  const saveTone = useCallback(
    async (toneValue) => {
      const agentId = createdRef.current?.agentId;
      const versionId = createdRef.current?.versionId;
      if (!agentId || !versionId) return { success: false, skipped: true };

      const tone = TONES.find((item) => item.value === toneValue);
      try {
        await ensureHydratedVersion(versionId);
        await dispatch(
          updateBridgeVersionAction({
            bridgeId: agentId,
            versionId,
            dataToSend: { settings: { tone: tone ? { value: tone.value, prompt: tone.prompt } : {} } },
          })
        );
        return { success: true };
      } catch (err) {
        console.error("Saving the tone failed", err);
        toast.error(err?.response?.data?.message || err?.message || "Could not save the tone.");
        return { success: false };
      }
    },
    [dispatch, ensureHydratedVersion]
  );

  /**
   * Bridge-level fields (name and `meta.ranger`) are written at create time,
   * but the wizard lets the user keep editing them afterwards — the agent may
   * already exist by the time they change the name or the colour, and deploy
   * skips create in that case. So they are pushed once more here. Non-fatal.
   */
  const syncIdentity = useCallback(
    async (form, agentId) => {
      try {
        await dispatch(
          updateBridgeAction({
            bridgeId: agentId,
            dataToSend: {
              name: form.name.trim(),
              meta: mergeRangerMeta(createdRef.current?.meta, form),
            },
          })
        );
      } catch (err) {
        console.error("Syncing the ranger name and meta failed", err);
      }
    },
    [dispatch]
  );

  const deploy = useCallback(
    async (form) => {
      // Everything below writes state across many awaits. If the wizard is
      // reset mid-deploy, those writes must not land on the fresh form — and
      // onDeployed must not fire for a run the user walked away from.
      const runId = runIdRef.current;
      const set = (setter, value) => {
        if (isCurrentRun(runId)) safeSet(setter, value);
      };

      set(setError, "");
      set(setChannelWarnings, []);

      try {
        // Wait for Identity's background create to finish instead of racing it into a second agent.
        if (creatingPromiseRef.current) {
          set(setPhase, DEPLOY_PHASES.CREATING);
          await creatingPromiseRef.current;
        }

        let agentId = createdRef.current?.agentId;
        let versionId = createdRef.current?.versionId;
        let createdService = createdRef.current?.service;
        // Captures a backend-generated prompt when form.prompt is empty (chat lets it be skipped).
        let effectiveForm = form;

        // ---- create (skipped on retry) ----
        if (!agentId) {
          set(setPhase, DEPLOY_PHASES.CREATING);
          const { agent, prompt, promptParts } = await runCreate(form);
          if (!agent?._id) throw new Error("Agent creation did not return an agent.");
          agentId = agent._id;
          versionId = agent.versions?.[0];
          createdService = agent.service;
          if (!versionId) throw new Error("Agent was created without a version.");
          createdRef.current = { agentId, versionId, service: createdService, meta: agent?.meta };
          set(setCreated, { agentId, versionId, name: form.name.trim() });

          await restoreName(agent, form.name);

          if (!form.prompt?.trim() && (prompt || promptParts)) {
            effectiveForm = { ...form, prompt: prompt || "", promptParts: promptParts || null };
          }

          // Backend may drop `meta` on create; make sure the ranger data lands.
          if (!agent?.meta?.ranger) {
            try {
              await dispatch(
                updateBridgeAction({ bridgeId: agentId, dataToSend: { meta: mergeRangerMeta(agent?.meta, form) } })
              );
            } catch (metaError) {
              console.error("Failed to persist ranger meta", metaError);
            }
          }

          await promoteToTrigger(agentId);
        }

        // ---- identity sync ----
        // Catches edits made after the agent was created (the prompt step can
        // create it well before Review).
        await syncIdentity(effectiveForm, agentId);

        // ---- hydrate (mandatory) ----
        // getBridgeVersionAction swallows its own errors and returns undefined,
        // so assert here rather than letting the next phase blow up two levels
        // deep inside a reducer.
        set(setPhase, DEPLOY_PHASES.HYDRATING);
        const hydrated = await dispatch(getBridgeVersionAction({ versionId }));
        if (!hydrated?._id) {
          throw new Error("Could not load the new ranger's version. It was created but is not configured yet.");
        }
        hydratedVersionRef.current = versionId;

        // ---- configure ----
        // Runs for AI mode too: the form (or the fallback above) is final, not the create response.
        set(setPhase, DEPLOY_PHASES.CONFIGURING);
        await runConfigure(effectiveForm, { agentId, versionId, createdService });

        // ---- tools (non-fatal) ----
        // Shares the configure phase rather than adding one of its own, so the
        // modal's phase list stays a fixed five steps.
        const toolIssues = await runTools(effectiveForm, { agentId, versionId });
        set(setToolWarnings, toolIssues);
        toolIssues.forEach((warning) => toast.warning(`Tool: ${warning.message}`));

        // ---- channels (non-fatal) ----
        set(setPhase, DEPLOY_PHASES.CHANNELS);
        const warnings = await runChannels(effectiveForm, { agentId, versionId });
        set(setChannelWarnings, warnings);
        warnings.forEach((warning) => toast.warning(`${warning.channel}: ${warning.message}`));

        // ---- publish ----
        set(setPhase, DEPLOY_PHASES.PUBLISHING);
        const result = await dispatch(
          publishBridgeVersionAction({ bridgeId: agentId, versionId, orgId, generate_summary: true })
        );
        // publishBridgeVersionApi swallows errors and returns the error object,
        // so a try/catch here proves nothing — check the flag.
        if (!result?.success) {
          throw new Error(result?.message || result?.response?.data?.message || "Publishing the ranger failed.");
        }

        await dispatch(getAllBridgesAction());
        if (!isCurrentRun(runId)) return { success: false };
        set(setPhase, DEPLOY_PHASES.DONE);
        toast.success(`${form.name.trim()} deployed and published.`);
        onDeployed?.({ agentId, versionId });
        return { success: true, agentId, versionId, warnings: [...warnings, ...toolIssues] };
      } catch (err) {
        console.error("Ranger deploy failed", err);
        set(setPhase, DEPLOY_PHASES.FAILED);
        set(setError, err?.response?.data?.message || err?.message || "Something went wrong while deploying.");
        return { success: false };
      }
    },
    [
      dispatch,
      isCurrentRun,
      onDeployed,
      orgId,
      promoteToTrigger,
      restoreName,
      runChannels,
      runConfigure,
      runCreate,
      runTools,
      safeSet,
      syncIdentity,
    ]
  );

  return {
    createFromIdentity,
    connectChannel,
    connectTool,
    connectedTools,
    saveTone,
    deploy,
    reset,
    phase,
    error,
    channelWarnings,
    toolWarnings,
    created,
    connectedChannels,
    identityPhase,
    identityError,
  };
};

export default useCreateRanger;
