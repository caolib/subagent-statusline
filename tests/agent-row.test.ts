import type { RenderPropsOf } from 'claude-code';
import { expect, test, mock } from 'claude-code/testing';
import { renderLine } from '../hooks/register';

const NOW = 1_800_000_000_000;
const BASE: RenderPropsOf['AgentRow'] = {
  id: 'agent-test', description: '检查渲染逻辑', type: 'Explore',
  status: 'running', kind: 'local_agent', taskStatus: 'running',
  label: '读取状态栏脚本', startTime: NOW - 125_000, cwd: 'C:/project',
  model: 'gateway/claude-sonnet-5-5[1m]', effort: 'medium',
  contextWindowSize: 1_000_000, tokenCount: 85_500, tokenSamples: [80_000, 85_500],
  hasRow: true, rowIds: ['agent-test'], columns: 160, isHidden: false,
};
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

test('保留名称、模型、时间、token、任务描述的顺序和配色', async () => {
  const line = renderLine(BASE, NOW);
  expect(plain(line)).toBe(
    'Explore  claude-sonnet-5-5(medium)  2m 5s  ↓ 85.5k  检查渲染逻辑  读取状态栏脚本',
  );
  expect(line.startsWith('\x1b[1;36mExplore\x1b[0m')).toBe(true);
  expect(line.includes('\x1b[38;2;217;119;87mclaude-sonnet-5-5(medium)\x1b[0m')).toBe(true);
});

test('token 静止与压缩下降显示上箭头', async () => {
  for (const tokenSamples of [[85_500, 85_500], [90_000, 85_500]]) {
    expect(plain(renderLine({ ...BASE, tokenSamples }, NOW)).includes('↑ 85.5k')).toBe(true);
  }
  expect(plain(renderLine({ ...BASE, tokenSamples: [] }, NOW)).includes('↓ 85.5k')).toBe(true);
});

test('按 columns 收窄字段，总宽不超过列宽', async () => {
  const line = renderLine({
    ...BASE, name: '名'.repeat(40), description: '述'.repeat(120), label: '描'.repeat(120),
    columns: 80,
  }, NOW);
  expect(Array.from(plain(line)).length <= 80).toBe(true);
  expect(plain(line).includes('描')).toBe(true);
  expect(plain(line).includes('述')).toBe(false);
});

test('行末显示当前工具动作，非运行状态不显示', async () => {
  const act = { tool: 'Read', target: 'hooks/register.ts', at: NOW };
  expect(plain(renderLine(BASE, NOW, act))).toBe(
    'Explore  claude-sonnet-5-5(medium)  2m 5s  ↓ 85.5k  检查渲染逻辑  读取状态栏脚本  Read hooks/register.ts',
  );
  expect(renderLine(BASE, NOW, act).endsWith('Read hooks/register.ts')).toBe(true);
  expect(plain(renderLine({ ...BASE, status: 'completed' }, NOW, act)).includes('Read hooks')).toBe(false);
  expect(plain(renderLine(BASE, NOW)).includes('Read hooks')).toBe(false);
});

test('模型家族使用简称，如 deepseek→ds、flash→f，并去掉 [1m] 与路径前缀', async () => {
  const line = plain(renderLine({
    ...BASE, model: 'group/DeepSeek-v4.1-flash-1017[1m]', effort: 'xhigh',
  }, NOW));
  expect(line.includes('ds-v4.1-f-1017(xhigh)')).toBe(true);
});

test('按模型家族着色：claude 品牌橙、deepseek 蓝、gpt 绿，未知用白色', async () => {
  const colorOf = (model: string) =>
    /(\x1b\[[0-9;]+m)(?:claude|ds-|gpt|qwen)/.exec(renderLine({ ...BASE, model }, NOW))?.[1];
  expect(colorOf('gateway/claude-sonnet-5-5')).toBe('\x1b[38;2;217;119;87m');
  expect(colorOf('gateway/deepseek-v4.1')).toBe('\x1b[34m');
  expect(colorOf('group/ds-v4.1-flash-1017[1m]')).toBe('\x1b[34m');
  expect(colorOf('openai/gpt-5')).toBe('\x1b[32m');
  expect(colorOf('local/qwen-3')).toBe('\x1b[97m');
});

test('尚未请求时不显示零 token、未知模型或未知 effort', async () => {
  const line = plain(renderLine({
    ...BASE, model: undefined, effort: undefined, tokenCount: 0, startTime: NOW,
  }, NOW));
  expect(line).toBe('Explore  检查渲染逻辑  读取状态栏脚本');
});

test('支持数字 effort，以及最近请求提供的继承 effort', async () => {
  expect(plain(renderLine({ ...BASE, effort: 0 }, NOW)).includes('(0)')).toBe(true);
  expect(plain(renderLine({
    ...BASE, effort: undefined,
    lastRequest: { at: NOW, model: BASE.model!, effort: 'high' },
  }, NOW)).includes('(high)')).toBe(true);
});

test('完成、失败、停止和等待不误显示为运行中', async () => {
  for (const [status, label] of [
    ['completed', 'done'], ['failed', 'failed'], ['killed', 'stopped'],
    ['pending', 'pending'], ['idle', 'pending'], ['waiting', 'pending'],
  ] as const) {
    expect(plain(renderLine({ ...BASE, status }, NOW)).includes('  ' + label + '  ')).toBe(true);
  }
});

test('子代理类型使用简称，如 general-purpose→general', async () => {
  const line = plain(renderLine({ ...BASE, name: undefined, type: 'general-purpose' }, NOW));
  expect(line.startsWith('general  ')).toBe(true);
  expect(line.includes('general-purpose')).toBe(false);
});

test('任务描述相同时不重复显示，名字优先于类型', async () => {
  const line = plain(renderLine({ ...BASE, name: '审查员', label: BASE.description }, NOW));
  expect(line.startsWith('审查员  ')).toBe(true);
  expect(line.match(/检查渲染逻辑/g)?.length).toBe(1);
});

test('清除注入的换行和控制符，不切断 emoji 的代理对', async () => {
  const line = renderLine({
    ...BASE, columns: undefined, name: '甲'.repeat(34) + '😀' + '乙乙',
    label: '阅读\n文件\t\x1b[2J', description: '',
  }, NOW);
  expect(plain(line).startsWith('甲'.repeat(34) + '😀…')).toBe(true);
  expect(line.includes('\n')).toBe(false);
  expect(line.includes('\x1b[2J')).toBe(false);
});

test('时间和大 token 格式与原脚本一致', async () => {
  expect(plain(renderLine({ ...BASE, startTime: NOW - 3_661_000, tokenCount: 1_200_000 }, NOW))
    .includes('1h 1m 1s  ↓ 1.2M')).toBe(true);
  expect(plain(renderLine({ ...BASE, startTime: NOW + 1000, tokenCount: Number.NaN }, NOW))
    .includes('NaN')).toBe(false);
});

test('AgentRow 真正通过 Mod 改写，保留旧的显隐与原生行元数据', async ($, on) => {
  mock.clock(on, { now: NOW });
  const rows: RenderPropsOf['AgentRow'][] = [];
  on('ui.render', { component: 'AgentRow' }, (_, e, next) => {
    rows.push(e.props);
    return next(e);
  });
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'subagent-statusline', surface, component: 'AgentRow', requestId: BASE.id,
      props: { ...BASE, body: '旧命令内容', isHidden: true, parentId: 'parent-agent' },
    });
    const row = rows[rows.length - 1];
    expect(row?.body).toBe(renderLine(BASE, NOW));
    expect(row?.id).toBe(BASE.id);
    expect(row?.parentId).toBe('parent-agent');
    expect(row?.isHidden).toBe(true);
    await ui.unmount();
  }
});
