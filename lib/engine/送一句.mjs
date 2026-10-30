// 送一句 —— 把"她要说的那句话"送到某一间会话里，让它真的开一轮。
//
// 这个模块只管**投递**这一件事，不管该不该说（那是判定那边的事）。
// 单独拆出来的理由：
//   1. 投递是唯一会真的碰到会话、会花 token、会失败的地方，失败模式要集中处理；
//   2. 它要兼容两种消息工厂（官方 / 手搓），这套兼容逻辑不该散在判定流程里；
//   3. 这里的每个 await 都不能漏 —— followup 返回 Promise，
//      漏接一次 rejection 就等于把整个宿主进程带走（Node 22+ 当致命错误）。

import { randomUUID } from 'node:crypto'

/** 官方消息工厂缓存：undefined=没试过，null=试过拿不到。 */
let 工厂缓存 = undefined

/**
 * 试着拿 @deepseek-ai/dsh-llm 的 createUserMessage。
 * 第三方插件装在 profile 的 node_modules 下，通常**没有**这个包 ——
 * 拿不到是正常现象，退回手搓，不报错也不刷日志。
 */
export async function 拿工厂() {
  if (工厂缓存 !== undefined) return 工厂缓存
  try {
    const 模块 = await import('@deepseek-ai/dsh-llm')
    if (模块 && typeof 模块.createUserMessage === 'function') {
      工厂缓存 = 模块
      return 工厂缓存
    }
  } catch (error) {
    // 预期内
  }
  工厂缓存 = null
  return null
}

/**
 * 手搓一条 user 消息。
 * 形状对齐 dsh-llm 的 createUserMessage：id / role / content[] / source.kind 都要齐，
 * dsh-session 的校验只认这几条。
 */
export function 手搓消息(文案, 源标记) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(文案) }],
    source: { kind: 源标记 },
  }
}

/**
 * 造一条消息（优先官方工厂）。
 * @param 文案 要说的那句话
 * @param 源标记 source.kind，用来区分"她自己开口"和"人打的字"
 */
export async function 造消息(文案, 源标记) {
  const 工厂 = await 拿工厂()
  if (工厂) {
    try {
      return 工厂.createUserMessage({ content: [{ type: 'text', text: 文案 }], source: { kind: 源标记 } })
    } catch (error) {
      // 工厂在但参数不认（版本差异）→ 退回手搓，别让这一句丢掉
    }
  }
  return 手搓消息(文案, 源标记)
}

/**
 * 送出去。
 * @param agent 目标 agent（必须有 followup）
 * @param 文案
 * @param 源标记
 * @param 落盘 传 { ctx } 会在送完之后尝试 flush，让这条先落盘（拿不到服务就跳过）
 * @returns { ok, 错误?, 落盘? }
 */
export async function 送一句({ agent, 文案, 源标记, ctx }) {
  if (!agent || typeof agent.followup !== 'function') {
    return { ok: false, 错误: '目标会话没有 followup（agent 不可用）' }
  }
  try {
    const 消息 = await 造消息(文案, 源标记)
    await agent.followup(消息)
  } catch (错误) {
    return { ok: false, 错误: String((错误 && 错误.message) || 错误) }
  }
  let 落盘 = 'skipped'
  if (ctx && ctx.sessions && typeof ctx.sessions.flush === 'function') {
    try {
      await ctx.sessions.flush(agent.session)
      落盘 = 'ok'
    } catch (错误) {
      落盘 = String((错误 && 错误.message) || 错误)
    }
  }
  return { ok: true, 落盘 }
}
