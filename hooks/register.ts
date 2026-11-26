import { atom, read, update } from 'claude-code';
import type { AgentStatus, Register, RenderPropsOf } from 'claude-code';
import type { AgentActivity } from '../types';

// 从用户现有 subagent-statusline.js 迁移；不运行子进程、不读取配置或会话文件。
const activity = atom(
  { plugin: 'subagent-statusline', key: 'activity' } as const,
  {} as Record<string, AgentActivity>,
  { shape: 'activity-1' },
);
const C = {
  name: '\x1b[1;36m', label: '\x1b[97m', desc: '\x1b[39m',
  model: '\x1b[34m', time: '\x1b[96m', dim: '\x1b[2m',
  done: '\x1b[32m', failed: '\x1b[31m', pending: '\x1b[33m',
  reset: '\x1b[0m',
};

type AgentRow = RenderPropsOf['AgentRow'];

// 子代理类型简称，按完整名称匹配，不区分大小写。
const AGENT_SHORT: Record<string, string> = { 'general-purpose': 'general' };

function shortName(raw: unknown, max: number): string {
  const text = sanitize(raw);
  return clip(AGENT_SHORT[text.toLowerCase()] ?? text, max);
}

function sanitize(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
}

function clean(value: unknown, max: number): string {
  return clip(sanitize(value), max);
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h ? h + 'h' : '', m ? m + 'm' : '', s ? s + 's' : '']
    .filter(Boolean).join(' ');
}

// 直接写入的网关 id 没有显示名，这里按路径补上 modelPicker 里的可读 label。
const MODEL_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\/)auto\/deepseek-v4\.1-flash/i, 'DeepSeek 4.1 Flash'],
  [/\/ds-v4\.1-flash-1017/i, 'DeepSeek 4.1 Flash'],
  [/\/gpt-6\.2-astra|\/gpt-6-astra/i, 'GPT 6.2 Astra'],
  [/\/gpt-6\.2-sol/i, 'GPT 6.2 Sol'],
  [/\/gpt-6\.1-sol/i, 'GPT 6.1 Sol'],
  [/\/gemini-4-neon/i, 'Gemini 4 Neon'],
  [/\/gemini-4-carbon/i, 'Gemini 4 Carbon'],
  [/\/claude-fable-5-2/i, 'Fable 5.2'],
];

function modelLabel(text: string): string {
  for (const [pattern, label] of MODEL_LABELS) {
    if (pattern.test(text)) return label;
  }
  return '';
}

// 模型家族配色：Claude 品牌橙 #d97757，GPT 用状态栏的绿色；未命中的用白色。
const MODEL_COLORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/claude|anthropic|sonnet|opus|haiku|fable/, '\x1b[38;2;217;119;87m'],
  [/deepseek|\bds\b/, C.model],
  [/gpt|openai/, '\x1b[32m'],
];
const DEFAULT_MODEL_COLOR = '\x1b[97m';

// Gemini 双色：深色终端用品牌值，浅色终端用高对比替代值。
type Rgb = readonly [number, number, number];
const GEMINI_DARK: readonly Rgb[] = [[0x32, 0x87, 0xfe], [0x16, 0xba, 0x67]];
const GEMINI_LIGHT: readonly Rgb[] = [[0x18, 0x5a, 0xbc], [0x13, 0x73, 0x33]];
const GEMINI_THEME: 'dark' | 'light' = 'dark';
const GEMINI_STOPS: readonly Rgb[] = GEMINI_THEME === 'dark' ? GEMINI_DARK : GEMINI_LIGHT;
const GEMINI_MODEL = /gemini|google/i;
// Claude Code 自身用的星芒字符，作为 Claude 家族前缀。
const CLAUDE_MODEL = /claude|anthropic|sonnet|opus|haiku|fable/i;

function fg(channels: readonly number[]): string {
  return `\x1b[38;2;${channels[0]};${channels[1]};${channels[2]}m`;
}

function mix(a: Rgb, b: Rgb, f: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

// 逐字符在双色间插值，渐变跨度随文字长度自适应。
function gradient(text: string): string {
  const chars = Array.from(text);
  const segs = GEMINI_STOPS.length - 1;
  return chars.map((ch, i) => {
    const t = chars.length > 1 ? (i / (chars.length - 1)) * segs : 0;
    const k = Math.min(Math.floor(t), segs - 1);
    const f = t - k;
    return fg(mix(GEMINI_STOPS[k]!, GEMINI_STOPS[k + 1]!, f)) + ch;
  }).join('') + C.reset;
}

// 星形、模型名与 effort 连成一段完整的蓝绿渐变。
function geminiStyle(text: string, effort: string): string {
  return gradient('✦ ' + text + (effort ? '(' + effort + ')' : ''));
}

// Gemini 的名字可能变化，只按家族词上色；其他家族保持单色前缀。
function modelText(raw: string | undefined, model: string, effort: string): string {
  if (GEMINI_MODEL.test(raw ?? '')) return geminiStyle(model, effort);
  const icon = CLAUDE_MODEL.test(raw ?? '') ? '✻ ' : '';
  return modelColor(raw) + icon + model + (effort ? '(' + effort + ')' : '') + C.reset;
}

function modelColor(raw: string | undefined): string {
  const name = (raw ?? '').toLowerCase();
  for (const [pattern, color] of MODEL_COLORS) {
    if (pattern.test(name)) return color;
  }
  return DEFAULT_MODEL_COLOR;
}

function shortModel(raw: string | undefined, max: number): string {
  const base = (raw ?? '').replace(/\[1m\]/gi, '').split('/').filter(Boolean).pop() ?? '';
  return clean(modelLabel(raw ?? '') || base, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// body 只含 SGR 样式，按可见字符计宽。
function visibleLen(text: string): number {
  return Array.from(text.replace(/\x1b\[[0-9;]*m/g, '')).length;
}

const PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead']);

function firstString(source: unknown, keys: readonly string[]): string {
  if (!source || typeof source !== 'object') return '';
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function shortPath(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
}

// 从工具参数里取最能说明"在做什么"的一项。
function targetOf(tool: string, event: unknown): string {
  const keys =
    tool === 'Bash' ? ['command']
    : tool === 'Grep' || tool === 'Glob' ? ['pattern']
    : tool === 'WebFetch' ? ['url']
    : tool === 'WebSearch' ? ['query']
    : tool === 'Agent' || tool === 'Task' ? ['description', 'subagent_type']
    : ['file_path', 'path', 'notebook_path', 'pattern', 'query', 'url', 'command', 'description'];
  const raw = firstString(event, keys) ||
    firstString((event as { input?: unknown } | null)?.input, keys);
  if (!raw) return '';
  return PATH_TOOLS.has(tool) ? shortPath(raw) : clean(raw, 40);
}

function activityText(entry: AgentActivity): string {
  return clean(entry.tool + (entry.target ? ' ' + entry.target : ''), 40);
}

function arrowOf(samples: readonly number[]): string {
  const previous = samples[samples.length - 2];
  const current = samples[samples.length - 1];
  if (previous !== undefined && current !== undefined &&
      Number.isFinite(previous) && Number.isFinite(current)) {
    return current > previous ? '↓' : '↑';
  }
  return '↓';
}

function statusInfo(status: AgentStatus): { label: string; color: string } | undefined {
  switch (status) {
    case 'running': return undefined;
    case 'completed': return { label: 'done', color: C.done };
    case 'failed': return { label: 'failed', color: C.failed };
    case 'killed': return { label: 'stopped', color: C.pending };
    case 'waiting':
    case 'idle':
    case 'pending': return { label: 'pending', color: C.pending };
  }
}

export function renderLine(agent: AgentRow, now: number, current?: AgentActivity): string {
  // columns 是行的可见列宽；未知时退回固定上限。
  const budget = Number.isFinite(agent.columns) && agent.columns! > 0
    ? Math.floor(agent.columns!)
    : 0;
  const limits = budget
    ? {
        name: clamp(Math.floor(budget * 0.16), 8, 36),
        model: clamp(Math.floor(budget * 0.16), 8, 48),
        desc: clamp(Math.floor(budget * 0.26), 8, 60),
        label: clamp(Math.floor(budget * 0.30), 8, 72),
      }
    : { name: 36, model: 48, desc: 60, label: 72 };

  const parts: string[] = [];
  const used = () => visibleLen(parts.join('  '));
  const room = () => (budget ? budget - used() - 2 : Number.POSITIVE_INFINITY);

  const name = shortName(agent.name ?? agent.type ?? agent.description, limits.name);
  if (name) parts.push(C.name + name + C.reset);

  const model = shortModel(agent.model, limits.model);
  // 原字段缺失时，使用引擎报告的最近一次请求 effort，不猜测继承值。
  const effort = clean(agent.effort ?? agent.lastRequest?.effort, 12);
  if (model) parts.push(modelText(agent.model, model, effort));

  const duration = fmtDuration(Math.max(0, now - agent.startTime));
  if (duration) parts.push(C.time + duration + C.reset);
  if (Number.isFinite(agent.tokenCount) && agent.tokenCount > 0) {
    parts.push(arrowOf(agent.tokenSamples) + ' ' + fmtTokens(agent.tokenCount));
  }

  const status = statusInfo(agent.status);
  if (status) parts.push(status.color + status.label + C.reset);

  const rawLabel = clean(agent.label ?? agent.description, limits.label);
  const rawDescription = clean(agent.description, limits.desc);
  const descriptionIsLabel = Boolean(rawDescription && rawLabel && rawDescription === rawLabel);
  // 窄行只留进度摘要，避免描述把 label 挤掉。
  const showDescription = budget === 0 || budget >= 100;

  if (showDescription && rawDescription && !descriptionIsLabel && rawDescription !== name) {
    const max = Math.min(limits.desc, room());
    if (max >= 4) parts.push(C.desc + clean(rawDescription, max) + C.reset);
  }
  if (rawLabel && rawLabel !== name) {
    const max = Math.min(limits.label, room());
    if (max >= 4) {
      parts.push((descriptionIsLabel ? C.desc : C.label) + clean(rawLabel, max) + C.reset);
    }
  }

  // 当前工具动作放在行末；完成的代理不再显示。
  if (current && agent.status === 'running') {
    const text = activityText(current);
    if (text && !rawLabel.includes(text)) {
      const max = Math.min(40, room());
      if (max >= 4) parts.push(clean(text, max));
    }
  }
  return parts.join('  ');
}

export const register: Register = (on) => {
  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId;
    if (agentId) {
      const entry: AgentActivity = {
        tool: clean(e.tool, 24),
        target: targetOf(e.tool, e),
        at: await $.clock.now(),
      };
      await update($, activity, (map) => {
        const merged: Record<string, AgentActivity> = { ...(map ?? {}), [agentId]: entry };
        const ids = Object.keys(merged);
        if (ids.length > 50) {
          ids.sort((a, b) => (merged[a]?.at ?? 0) - (merged[b]?.at ?? 0));
          for (const id of ids.slice(0, ids.length - 50)) delete merged[id];
        }
        return merged;
      });
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'AgentRow' }, async ($, e, next) => {
    const map = await read($, activity);
    const body = renderLine(e.props, await $.clock.now(), map[e.props.id]);
    // 保留引擎的行指针、嵌套连接线、显隐及打开/停止行为；替换旧命令的 body。
    return next({ ...e, props: { ...e.props, body } });
  });
};
