"use client";

import React, { useState } from "react";
import OpenAiIcon from "@/icons/OpenAiIcon";
import { RANGER_CHANNELS, CALLSIGN_BY_HEX } from "./rangerConstants";

const CHANNEL_BY_KEY = RANGER_CHANNELS.reduce((acc, channel) => {
  acc[channel.key] = channel;
  return acc;
}, {});

/** Helmet art per swatch. Purple borrows blue, pink borrows red — no dedicated art yet. */
const HELMET_BY_HEX = {
  "#E03131": "red",
  "#1C7ED6": "blue",
  "#2F9E44": "green",
  "#7048E8": "blue",
  "#D6336C": "red",
  "#F2540B": "yellow",
  "#495057": "black",
};

const formatNumber = (value, digits = 0) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(numeric);
};

/** The ranger's accent at a given alpha, for tints no theme token can express. */
const tint = (hex, alpha) => {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

/**
 * A single ranger in the squad grid, built to the design source's measurements.
 *
 * `row` is the same shape the table consumes (built in the agents page), plus `ranger`
 * for the colour/role read out of `meta.ranger`, and `channels` (keys of the messaging
 * channels this agent has credentials for). `index` is the roster position, shown as the
 * card's number.
 *
 * The subtitle reads "<callsign> · <role>": the callsign comes from the swatch so every
 * ranger has one even before a role is written.
 */
const RangerCard = ({ row, ranger, channels = [], metrics, isLoading, index = 0, onOpen, onHover, onMenuClick }) => {
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [hot, setHot] = useState(false);
  const isPaused = row?.bridge_status === 0;
  const accent = ranger?.color;
  const callsign = CALLSIGN_BY_HEX[accent] || "Ranger";
  const subtitle = ranger?.role ? `${callsign} · ${ranger.role.toLowerCase()}` : callsign;
  const helmet = HELMET_BY_HEX[accent] || "red";

  /**
   * Duty is the pause switch, not usage: a ranger that is switched on counts as on duty
   * whether or not it has been called yet, and a paused one is on standby even if it ran
   * all week.
   */
  const onDuty = !isPaused;

  /**
   * Whether there is any usage to draw. Kept apart from duty because it drives the power
   * bars, which describe the usage figures above them rather than the switch.
   */
  const hasUsage = Boolean(row.lastRunLabel && row.lastRunLabel !== "—");

  /** Power bar under each usage figure. Fills once on mount, and only when there is usage. */
  const bar = (fraction) => ({
    display: "block",
    marginTop: "6px",
    height: "3px",
    borderRadius: "999px",
    width: `${(fraction || 0.18) * 100}%`,
    background: hasUsage ? accent : "var(--line)",
    opacity: hasUsage ? 1 : 0.6,
    animation: hasUsage ? "rgPower .9s cubic-bezier(.2,.8,.3,1) both" : "none",
  });

  const dot = { width: "3px", height: "3px", borderRadius: "999px", background: "var(--soft)" };

  return (
    <article
      data-testid={`ranger-card-${row._id}`}
      id={`ranger-card-${row._id}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(row);
        }
      }}
      onMouseEnter={() => {
        setHot(true);
        onHover?.(row);
      }}
      onMouseLeave={() => {
        setHot(false);
        setChannelsOpen(false);
      }}
      className="group relative flex cursor-pointer flex-col overflow-hidden bg-card"
      style={{
        borderRadius: "18px",
        border: `1px solid ${hot ? tint(accent, 0.55) : "var(--line)"}`,
        boxShadow: hot
          ? `0 18px 34px -18px ${tint(accent, 0.55)}, 0 2px 0 ${tint(accent, 0.35)}`
          : "0 1px 2px var(--shadow-tint)",
        transform: hot ? "translateY(-4px) rotate(-.4deg)" : "none",
        transition: "transform .28s cubic-bezier(.2,.8,.3,1), box-shadow .28s ease, border-color .28s ease",
      }}
    >
      {/* Helmet art, masked to a soft ellipse on the right. It turns towards the viewer on
          hover — the card is the light source, so the art follows rather than moves. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 top-0 z-0 block"
        style={{
          right: "-90px",
          backgroundImage: `url(/icons/helmets/${helmet}.jpg)`,
          backgroundRepeat: "no-repeat",
          backgroundSize: "auto 360px",
          backgroundPosition: "calc(100% - 50px) -28px",
          transform: hot ? "perspective(700px) rotateY(8deg) scale(1.04)" : "perspective(700px) rotateY(18deg)",
          transformOrigin: "84% 50%",
          opacity: hot ? 0.22 : 0.13,
          WebkitMaskImage: "radial-gradient(ellipse 36% 70% at 84% 42%, #000 30%, transparent 96%)",
          maskImage: "radial-gradient(ellipse 36% 70% at 84% 42%, #000 30%, transparent 96%)",
          transition: "transform .5s cubic-bezier(.2,.8,.3,1), opacity .3s ease",
        }}
      />

      {/* One sheen sweep per hover. Mounted on `hot` so it replays each time rather than
          running once and never again. */}
      {hot && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 top-0 z-[1] block w-2/5"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.6) 50%, rgba(255,255,255,0) 100%)",
            animation: "rgSheen 1.1s ease-out both",
          }}
        />
      )}

      <div className="relative z-[2] px-[14px] pb-[14px] pt-[12px]">
        <div className="flex items-start justify-between gap-2">
          <span
            className="rounded-full px-2 py-[3px] font-mono text-[11px] font-bold tracking-[.1em]"
            style={{ background: tint(accent, 0.16), color: accent }}
          >
            #{String(index + 1).padStart(2, "0")}
          </span>

          <div
            role="button"
            tabIndex={0}
            data-testid={`ranger-card-menu-${row._id}`}
            aria-label="Ranger actions"
            className="flex flex-none cursor-pointer flex-col gap-[2.5px] px-[2px] py-1 opacity-45 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMenuClick(event, row);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onMenuClick(event, row);
              }
            }}
          >
            <span style={dot} />
            <span style={dot} />
            <span style={dot} />
          </div>
        </div>

        <div className="flex items-start gap-3 pt-[22px]">
          <span className="relative h-10 w-10 flex-none">
            <span className="relative grid h-10 w-10 place-items-center rounded-[12px] border border-line bg-card shadow-[0_1px_3px_var(--shadow-tint)]">
              {isLoading ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <OpenAiIcon width={20} height={20} />
              )}
            </span>
          </span>

          <span className="flex min-w-0 flex-1 flex-col pr-[10px]">
            <span
              className="text-[17px] font-extrabold leading-[1.15] tracking-[-0.03em] text-ink"
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
                overflowWrap: "anywhere",
              }}
              title={row.actualName}
            >
              {row.actualName || "Untitled"}
            </span>
            <span
              className="mt-1 truncate font-mono text-[9.5px] font-semibold uppercase leading-[1.5] tracking-[.16em]"
              style={{ color: accent }}
              title={subtitle}
            >
              {subtitle}
            </span>
          </span>
        </div>
      </div>

      <div className="relative z-[2] flex flex-1 flex-col px-[14px] pt-3">
        {ranger?.description && (
          <p className="mb-[10px] line-clamp-2 text-[12.5px] leading-[1.55] text-soft">{ranger.description}</p>
        )}

        <div className="mt-auto flex items-center gap-2 pb-3">
          {row.model && (
            <span
              className="min-w-0 flex-shrink truncate rounded-[6px] border border-line bg-card-band px-[7px] py-[3px] font-mono text-[10.5px] text-soft"
              title={row.model}
            >
              {row.model}
            </span>
          )}

          {channels.length > 0 && (
            <span
              className="inline-flex min-w-0 flex-[0_1_auto] items-center overflow-hidden"
              onMouseEnter={() => setChannelsOpen(true)}
              onMouseLeave={() => setChannelsOpen(false)}
            >
              {channels.map((key, position) => {
                const channel = CHANNEL_BY_KEY[key];
                if (!channel) return null;
                const Icon = channel.icon;
                return (
                  <span
                    key={key}
                    title={channel.label}
                    // inline-flex, not grid: with an icon and a label as siblings, grid
                    // stacks them in two rows and the icon stops being centred.
                    className="inline-flex h-6 flex-none items-center justify-center rounded-full border border-line bg-card"
                    style={{
                      // A collapsed pill is a circle, so its width is pinned to its height
                      // and it carries no padding — otherwise the label's own spacing
                      // widens it into an oval with the icon sitting off-centre.
                      width: channelsOpen ? "auto" : "24px",
                      padding: channelsOpen ? "0 8px 0 5px" : 0,
                      marginLeft: position === 0 ? 0 : channelsOpen ? "4px" : "-10px",
                      zIndex: 10 - position,
                      transition: "margin-left .22s cubic-bezier(.2,.8,.3,1), padding .22s ease, width .22s ease",
                    }}
                  >
                    <Icon size={15} className="flex-none" />
                    <span
                      className="overflow-hidden whitespace-nowrap font-mono text-[10px] font-semibold text-ink"
                      style={{
                        maxWidth: channelsOpen ? "60px" : 0,
                        paddingLeft: channelsOpen ? "5px" : 0,
                        transition: "max-width .22s ease, padding-left .22s ease",
                      }}
                    >
                      {channel.label}
                    </span>
                  </span>
                );
              })}
            </span>
          )}

          <span className="flex-1" />

          <span
            className="flex-none whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[.08em]"
            style={{
              background: onDuty ? tint(accent, 0.14) : "var(--paper)",
              color: onDuty ? accent : "var(--soft)",
            }}
          >
            {onDuty ? "on duty" : "standby"}
          </span>
        </div>
      </div>

      {/* Usage — mirrors the table's cost/token/last-run columns so the usage filter stays meaningful */}
      <div className="relative z-[2] grid grid-cols-3 border-t border-card-line bg-card-band">
        <div className="border-r border-card-line px-3 py-[9px]">
          <div className="truncate font-mono text-[13px] font-bold text-ink">
            {metrics ? `$${Number(metrics.total_cost ?? 0).toFixed(4)}` : "—"}
          </div>
          <div className="text-[10px] text-soft">Cost</div>
          <span aria-hidden style={bar(0.35)} />
        </div>
        <div className="border-r border-card-line px-3 py-[9px]">
          <div className="truncate font-mono text-[13px] font-bold text-ink">
            {metrics ? formatNumber(metrics.total_tokens) : "—"}
          </div>
          <div className="text-[10px] text-soft">Tokens</div>
          <span aria-hidden style={bar(0.62)} />
        </div>
        <div className="px-3 py-[9px]">
          <div className="truncate font-mono text-[13px] font-bold text-ink">{row.lastRunLabel || "—"}</div>
          <div className="text-[10px] text-soft">Last run</div>
          <span aria-hidden style={bar(0.9)} />
        </div>
      </div>
    </article>
  );
};

export default RangerCard;
