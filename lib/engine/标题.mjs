// 会话标题 —— 设置页里那串 `session-xxxx` 得变成人看得懂的名字。
//
// 两个来源，按可靠程度排队，谁先给得出就用谁：
//
//   ① **会话标题服务**（`ctx.get('sessionTitle')`）
//      纯内存，改完名字立刻能看到，所以不缓存。
//   ② **投影缓存文件**
//      `<DSH_HOME>/storages/session_projcache/sessions/<id>.json`
//      里面 `record.rows.title.val` 是标题；没有就退一步用
//      `record.rows.titleInput.val.first.text`（首条消息的前几个字）。
//      这条要读盘，所以结果缓存 30 秒。
//
// 为什么单独一个模块：
//   · 标题缓存原来是模块级的 Map —— 插件重载一次就多留一份旧数据。
//     这里改成「标题器」实例持有缓存，卸载时跟着一起没。
//   · 两条来源的顺序、缓存时长、截断规则都收在一处，改哪一条不用翻整个 host.js。
//
// 三条硬规矩（都是踩出来的）：
//   · **文件名两种写法都要试**：id 可能带 `session-` 前缀，也可能不带，拼错就永远读不到；
//   · 超过体积上限的缓存文件**直接跳过**，别为了一个标题去解析几十兆的 json；
//   · 任何一路失败都**静默降级**，绝不让「拿不到标题」把设置页拖下水。

const 默认上限字节 = 8 * 1024 * 1024
const 默认缓存毫秒 = 30 * 1000
const 标题最多字 = 24

/** 非空字符串才算数。 */
function 非空(值) {
  return typeof 值 === 'string' && 值.trim() !== '' ? 值.trim() : undefined
}

/** 压成一行并截断 —— 标题带换行会把列表撑开。 */
export function 压成一行(文本) {
  const 一行 = String(文本).replace(/\s+/g, ' ').trim()
  if (一行 === '') return ''
  return 一行.length <= 标题最多字 ? 一行 : 一行.slice(0, 标题最多字 - 1) + '…'
}

/** id 的两种写法（原样 / 补前缀 / 去前缀），去重。 */
export function 文件名候选(id) {
  const 原 = String(id)
  return [...new Set([原, 原.startsWith('session-') ? 原.slice(8) : 'session-' + 原])]
}

/** `titleInput.val` 的 first 可能是对象、字符串或数组，三种都认。 */
function 首条文本(输入) {
  if (!输入 || typeof 输入 !== 'object') return undefined
  const 首 = 输入.first !== undefined ? 输入.first : Array.isArray(输入) ? 输入[0] : undefined
  if (typeof 首 === 'string') return 非空(首)
  if (首 && typeof 首.text === 'string') return 非空(首.text)
  return undefined
}

/**
 * 建一个标题器。
 * @param 读目录 () => string   投影缓存目录（延迟取，免得 import 时就要求目录已定）
 * @param 读上限字节 number
 * @param 缓存毫秒 number
 * @param 读文件 注入点（测试可以喂假的）
 */
export function 建标题器({
  读目录,
  上限字节 = 默认上限字节,
  缓存毫秒 = 默认缓存毫秒,
  读文件,
  取文件信息,
}) {
  const 缓存 = new Map()

  /** ② 投影缓存这条路。 */
  function 从缓存文件拿(id) {
    const 目录 = 读目录()
    if (!目录) return undefined
    for (const 名 of 文件名候选(id)) {
      const 路 = 目录.replace(/[\\/]+$/, '') + '/' + 名 + '.json'
      try {
        const 信息 = 取文件信息 ? 取文件信息(路) : undefined
        if (信息 && (!信息.isFile || !信息.isFile() || info_太大(信息.size))) continue
        const 原文 = 读文件 ? 读文件(路) : undefined
        if (原文 === undefined) continue
        const 格 = JSON.parse(原文)?.record?.rows
        if (!格) continue
        const 标题 = 非空(格.title?.val)
        if (标题) return { 标题: 压成一行(标题), 来源: '投影缓存 title' }
        const 首条 = 首条文本(格.titleInput?.val)
        if (首条) return { 标题: 压成一行(首条), 来源: '投影缓存 titleInput（第一条消息）' }
      } catch (错误) {
        // 不在 / 坏了 / 不是 json —— 换下一个写法继续试
      }
    }
    return undefined
  }

  function info_太大(字节) {
    return Number(字节) > 上限字节
  }

  /**
   * 拿一个会话的标题，**永远返回 { 标题, 来源 }**（标题可能是空串）。
   * @param ctx 插件上下文（用来问 sessionTitle 服务）
   * @param id 会话 id
   * @param 会话 已经有 Session 对象就传进来，省一次查找
   */
  function 取(ctx, id, 会话) {
    // ① 会话标题服务
    try {
      const 服务 = ctx?.get ? ctx.get('sessionTitle') : undefined
      if (服务 && typeof 服务.get === 'function') {
        let 目标 = 会话
        if (!目标 && ctx.sessions && typeof ctx.sessions.get === 'function') {
          try {
            目标 = ctx.sessions.get(String(id))
          } catch (错误) {
            目标 = undefined
          }
        }
        if (目标) {
          const 标题 = 非空(服务.get(目标)?.title)
          if (标题) return { 标题: 压成一行(标题), 来源: '会话标题服务' }
        }
      }
    } catch (错误) {
      // 服务不在 / 抛错 → 走下一条路
    }

    // ② 投影缓存（带缓存）
    const 键 = String(id)
    const 记着 = 缓存.get(键)
    if (记着 && 记着.到 > Date.now()) return 记着
    const 结果 = 从缓存文件拿(id)
    const 落 = {
      标题: 结果?.标题 || '',
      来源: 结果?.来源 || '没有',
      到: Date.now() + 缓存毫秒,
    }
    缓存.set(键, 落)
    return 落
  }

  /** 卸载时清掉缓存（跟着插件一起没）。 */
  function 收摊() {
    缓存.clear()
  }

  return { 取, 收摊 }
}
