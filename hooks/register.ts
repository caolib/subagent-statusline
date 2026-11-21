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
  name: '\x1b[1;36m', label: '\x1b[97m', desc: '\x1b[35m',
  model: '\x1b[34m', time: '\x1b[96m', dim: '\x1b[2m',
  done: '\x1b[32m', failed: '\x1b[31m', pending: '\x1b[33m',
  reset: '\x1b[0m',
};

type AgentRow = RenderPropsOf['AgentRow'];

function clean(value: unknown, max: number): string {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
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

function shortModel(raw: string | undefined, max: number): string {
  const model = clean((raw ?? '').replace(/\[1m\]/gi, ''), max);
  return model.split('/').filter(Boolean).pop() ?? '';
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

  const name = clean(agent.name ?? agent.type ?? agent.description, limits.name);
  if (name) parts.push(C.name + name + C.reset);

  const model = shortModel(agent.model, limits.model);
  // 原字段缺失时，使用引擎报告的最近一次请求 effort，不猜测继承值。
  const effort = clean(agent.effort ?? agent.lastRequest?.effort, 12);
  if (model) parts.push(C.model + model + (effort ? '(' + effort + ')' : '') + C.reset);

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
