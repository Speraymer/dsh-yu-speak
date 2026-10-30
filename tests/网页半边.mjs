// tests/网页半边.mjs —— 设置页（lib/client.js）的结构、文案与交互
//
// 跑法： node --test tests/*.mjs
//
// 做法：用**假的 React**（useState 真的存值、setter 真的改值）把设置页渲染成一棵
// 普通对象树，再用**假的 fetch** 接住它对宿主说的每一句话。
// 所以「点一下 = 勾上 + 当场落盘」这条是真跑过去的，不是只看字符串在不在。
//
// 验的是：
//   1) 模块身份：load.id 等于包名、inject 只依赖 slots、挂在 settings.section 上；
//   2) 九张卡按新 client.js 的样子都在，十几个设置项一个不缺；
//   3) 「命中线 / 时机因子 / 攒加成 / 安静时段」这些口径的现行说法（旧说法要绝迹）；
//   4) 会话清单每行 = 复选框 + 标题 + 尾巴号 + 状态，点了立刻 POST /save，补丁里只带目标会话；
//   5) 手填 id、保存、演练、真发、重读、新建、查更新，各自打到哪条路由；
//   6) 脏 → 悬浮保存条 → 保存完收起来；保存失败要有红字；
//   7) 没读到状态 / 空数据 / 旧形状都不崩。
// ⚠ 验不了的：真实浏览器里的样式与网络往返。
//
// ⚠ 这份文件里**没有**照抄上游的断言清单 —— 锚点全部照新 client.js 重取
//   （例如没标题的会话现在是「（未命名会话）」，不是「（还没起名）」）。

import test from 'node:test'
import assert from 'node:assert/strict'

// ---------- 把外壳的模块加载器接住 ----------

let 捕获 = null
globalThis.window = { __ModuleLoader__: { load: (o) => { 捕获 = o } } }

// ---------- 假的宿主 ----------

const 端点 = '/dsh-speak-up'
let 请求 = []
let 让保存失败 = false
let 服务端 = { 配置: {}, 日志: [], 活着的会话: [] }

const ID_长 = 'session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f'

const 会话清单 = [
  { id: 'sess-abc', 标题: '甲会话', 标题来源: '会话标题服务', 状态: 'idle', 有agent: true, 归档: false },
  { id: ID_长, 标题: '乙会话', 标题来源: '投影缓存 title', 状态: 'idle', 有agent: true, 归档: false },
  { id: 'sess-没名字', 标题: '', 标题来源: '没有', 状态: '没活着', 有agent: false, 归档: false },
  { id: 'sess-归档了', 标题: '', 标题来源: '没有', 状态: '没活着', 有agent: false, 归档: true },
]

const 默认配置 = {
  总开关: true,
  试运行: true,
  目标会话: ['sess-abc'],
  间隔分钟: 30,
  峰时命中线: 20,
  谷时命中线: 60,
  没中加成: 10,
  加成上限: 40,
  安静起: 1,
  安静止: 8,
  近阈值分钟: 20,
  近因子: 0.15,
  远阈值分钟: 360,
  远因子: 1.5,
  搭话冷却分钟: 20,
  触发文案: '（这里是她自己写的那句话）',
  角色: 'user',
}

/** 宿主那份快照：目标情况 / 目标活着 都从当前配置现算，跟真宿主一个口径。 */
function 快照() {
  const 目标 = Array.isArray(服务端.配置.目标会话) ? 服务端.配置.目标会话 : []
  const 情况 = 目标.map((id) => {
    const 一 = 会话清单.find((x) => x.id === id) || {}
    return {
      id,
      短id: String(id).slice(-8),
      标题: 一.标题 || '',
      标题来源: 一.标题来源 || '没有',
      活着: 一.有agent === true,
    }
  })
  return {
    ok: true,
    版本: '2.1.0',
    配置文件: 'C:/x/speak-up-config.json',
    配置: 服务端.配置,
    日志: 服务端.日志,
    目标情况: 情况,
    目标活着: 情况.some((x) => x.活着),
    活着的会话: 服务端.活着的会话,
  }
}

/** 建一份新的宿主状态，返回可以塞进 状态槽[态] 的那个对象。 */
function 建态({ 目标 = ['sess-abc'], 日志 = [{ 时间: '10-31 03:00:00', 文本: '已装好 v2.1.0' }], 配置 = {} } = {}) {
  服务端 = {
    配置: { ...默认配置, 目标会话: 目标, ...配置 },
    日志,
    活着的会话: 会话清单,
  }
  请求 = []
  return 快照()
}

const 应 = (体) => ({ json: async () => 体 })

globalThis.fetch = async (url, 选项) => {
  const 路径 = String(url)
  const 方法 = (选项 && 选项.method) || 'GET'
  let 体 = null
  try { 体 = 选项 && 选项.body ? JSON.parse(选项.body) : null } catch (错误) { 体 = null }
  请求.push({ 路径, 方法, 体 })

  if (路径.endsWith('/save')) {
    if (让保存失败) return 应({ ok: false, 说: '写不进配置文件：C:/x/speak-up-config.json' })
    服务端.配置 = { ...服务端.配置, ...(体 || {}) }
    return 应({ ...快照(), 说: '保存好了' })
  }
  if (路径.endsWith('/roll')) {
    const 模式 = (体 && 体.模式) === '真发' ? '真发' : '演练'
    return 应({ ok: true, 说: `已经按「${模式}」跑了一次`, 日志: 服务端.日志 })
  }
  if (路径.endsWith('/new-session')) {
    return 应({ ...快照(), ok: true, 新会话: 'session-新开的', 说: '建好了：session-新开的，已经勾上' })
  }
  if (路径.endsWith('/update')) {
    return 应({ ok: true, current: '2.1.0', latest: '2.1.0', hasUpdate: false })
  }
  return 应(快照())
}

// ---------- 假的 React：useState 真的存值 ----------

let 状态槽 = []
let 下标 = 0
let 要重渲染 = false

const 造React = () => ({
  createElement: (t, p, ...kids) => ({
    t,
    p: p || {},
    kids: kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false),
  }),
  useState: (init) => {
    const i = 下标++
    if (!(i in 状态槽)) 状态槽[i] = init
    return [
      状态槽[i],
      (v) => {
        状态槽[i] = typeof v === 'function' ? v(状态槽[i]) : v
        要重渲染 = true
      },
    ]
  },
  useEffect: () => {},
  useCallback: (f) => f,
})

const 假require = (名) => {
  if (名 === 'react') return 造React()
  throw new Error('这个客户端包不该 require 别的：' + 名)
}

// ---------- 把模组装进来 ----------

await import(new URL('../lib/client.js', import.meta.url).href)
const 导出 = 捕获.factory(假require)

/**
 * 挂一次，把「注册了什么」和「那页组件」留在外面：
 * 后面几十条用例都是渲染同一个组件、看它对宿主说了什么。
 */
let 注册记录 = null
let 组件 = null
{
  const slots = {
    inject: (名, cb) => {
      assert.equal(名, 'settings.section')
      cb()
    },
    register: (定义, c) => {
      注册记录 = 定义
      组件 = c
      return () => {}
    },
  }
  导出.apply({ get: (名) => (名 === 'slots' ? slots : undefined) })
}

// 设置页里 useState 的调用顺序（改顺序 = 页面上错位，所以这里写死一份）
const 槽 = { 态: 0, 草稿: 1, 回话: 2, 忙: 3, 手填: 4, 落盘: 5, 更新: 6, 查着: 7 }

const 渲染 = () => { 下标 = 0; 要重渲染 = false; return 组件() }
const 造槽 = (态, 覆盖 = {}) => {
  状态槽 = [态, {}, '', false, null, '', null, false]
  for (const [名, 值] of Object.entries(覆盖)) 状态槽[槽[名]] = 值
  return 渲染()
}

// ---------- 走树的小工具 ----------

const 节点们 = (树) => {
  const 出 = []
  const 走 = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const x of n) 走(x); return }
    出.push(n)
    for (const k of n.kids || []) 走(k)
  }
  走(树)
  return 出
}

const 文字 = (树) => {
  const 块 = []
  const 走 = (n) => {
    if (n === undefined || n === null || n === false) return
    if (typeof n !== 'object') { 块.push(String(n)); return }
    if (Array.isArray(n)) { for (const x of n) 走(x); return }
    for (const k of n.kids || []) 走(k)
  }
  走(树)
  return 块.join('\n')
}

const 按钮们 = (树) => 节点们(树).filter((n) => n.t === 'button')
const 找按钮 = (树, 名) => 按钮们(树).find((b) => b.p.title === 名)
const 输入框 = (树, 类型) => 节点们(树).filter((n) => n.t === 'input' && n.p.type === 类型)
const 数字们 = (树) => 输入框(树, 'number')
/** 清单里的一行：label 里第一个孩子是复选框。 */
const 会话行们 = (树) =>
  节点们(树).filter((n) => n.t === 'label' && n.kids[0] && n.kids[0].t === 'input' && n.kids[0].p.type === 'checkbox')
/** 按会话 id 找行（行的 title 属性以 id 开头，比按文案找稳）。 */
const 找行 = (树, id) => 会话行们(树).find((r) => String(r.p.title || '').startsWith(id))
const 是浮条 = (n) => !!(n && n.p && n.p.style && n.p.style.position === 'sticky' && n.p.style.bottom === 0)
const 点 = async (节点) => { await 节点.p.onChange({ target: { checked: !节点.p.checked } }) }
const 改编 = async (节点, 值) => { await 节点.p.onChange({ target: { value: 值 } }) }
const 等一拍 = () => new Promise((r) => setTimeout(r, 0))

/** 让某个东西「不见 / 出现」，失败时把文字一起打出来。 */
const 要含 = (文, ...片段) => {
  for (const 段 of 片段) assert.ok(String(文).includes(段), `页面上应含「${段}」，实际：${文}`)
}
const 不该含 = (文, ...片段) => {
  for (const 段 of 片段) assert.ok(!String(文).includes(段), `页面上不该再有「${段}」`)
}

// =====================================================================

test('网页半边', async (t) => {
  // ---------------------------------------------------------------- 1
  await t.test('模块身份：load.id 等于包名、只依赖 slots、挂在 settings.section 上', () => {
    assert.equal(捕获.id, 'dsh-yu-speak', 'load.id 必须等于包名，否则壳会当成没注册')
    assert.deepEqual(导出.inject, ['slots'])

    assert.ok(注册记录, 'apply 之后应当注册了一页')
    assert.equal(注册记录.name, 'settings.section')
    assert.equal(注册记录.id, 'speak-up', '侧栏按 id 找页，改了就找不到')
    assert.equal(注册记录.order, 53)
    assert.equal(注册记录.label(), '主动说话')

    // 拿不到 slots 就安安静静地别加载（不抛错，也不该把已经挂好的那页顶掉）
    assert.doesNotThrow(() => 导出.apply({ get: () => undefined }))
  })

  const 树0 = 造槽(建态())
  const 文0 = 文字(树0)

  // ---------------------------------------------------------------- 2
  await t.test('九张卡都在，标题就是新 client.js 里那几个', () => {
    要含(
      文0,
      '主动说话',
      '插件版本',
      '先决定开不开口',
      '多久掷一次',
      '这一掷怎么算',
      '安静时段',
      '目标会话',
      '送出去的那句话',
      '自己动手试',
      '记账（新的在最下面）',
    )
    assert.equal(树0.t, 'div')
    // 版本和配置文件写在一行，出问题好让人知道去哪儿翻
    要含(文0, '版本 2.1.0 · 设置写在 C:/x/speak-up-config.json')
  })

  await t.test('每个设置项都在页面上（一个都不缺）', () => {
    要含(
      文0,
      '总开关',
      '试运行（出厂就是开的）',
      '间隔分钟',
      '搭话冷却分钟',
      '峰时命中线（%）',
      '谷时命中线（%）',
      '近阈值分钟 / 近因子',
      '远阈值分钟 / 远因子',
      '没中加成（百分点）',
      '加成上限（百分点）',
      '安静起 / 安静止（小时）',
      '触发文案',
      '角色',
    )
  })

  await t.test('12 个数字框、1 个手填框、1 个多行文案，各在各的位置', () => {
    const 数 = 数字们(树0)
    assert.equal(数.length, 12, '数字框数量：' + 数.map((n) => n.p.value).join(','))
    const 值 = 数.map((n) => Number(n.p.value))
    for (const 期望 of [30, 20, 60, 20, 0.15, 360, 1.5, 10, 40, 1, 8]) {
      assert.ok(值.includes(期望), `数字框里应该有 ${期望}，实际：${值.join(',')}`)
    }
    assert.ok(!值.includes(0.5), '旧版那个 0.5 的因子框不该再出现')

    const 手填 = 输入框(树0, 'text')
    assert.equal(手填.length, 1, '整页只留「手填 id」这一个文本框')
    assert.equal(手填[0].p.value, 'sess-abc', '没碰过的时候显示配置里那一份')
    assert.ok(String(手填[0].p.placeholder).includes('session-'))

    const 多行 = 节点们(树0).filter((n) => n.t === 'textarea')
    assert.equal(多行.length, 1)
    assert.equal(多行[0].p.value, '（这里是她自己写的那句话）')
  })

  // ---------------------------------------------------------------- 3
  await t.test('「命中线」那套口径：先说每轮怎么掷，再说算式怎么算', () => {
    要含(
      文0,
      '每轮在 0～100 里取一个数，落在命中线下面才开口；落在上面就不开。',
      '① 基础命中线 —— 贵的时候压低，便宜的时候抬高',
      '② 时机因子 —— 刚聊完就少开口，晾太久就多开口',
      '③ 连着没中就攒加成 —— 一次比一次容易',
      '总账：线 = 基础线（看是峰时还是谷时）× 时机因子 + 攒下来的加成，算完夹在 0～100。',
    )
    // 她特意纠正过：那不叫概率。旧说法一处都不许留
    不该含(文0, '掷中概率', '峰时概率', '谷时概率', '有效概率')
  })

  await t.test('攒加成：清零口径、只管自动那一轮、只在内存里', () => {
    要含(
      文0,
      '填 0 就是不要这套攒加成，一分都不加。',
      '掷中一次（试运行里掷中算）就清零，从 0 重新攒',
      '这两格只管自动的定时掷骰。「演练一次 / 真发一次」不掷骰，也不动这个计数。',
      'DSH 一重启就归零',
    )
  })

  await t.test('峰谷：时段写死、只剩两个数要填', () => {
    要含(
      文0,
      '峰时是写死的，不用你填 —— 周一~周五 9:00~12:00、14:00~18:00。',
      '其余全算谷时 —— 午休 12:00~14:00、18:00 到次日 9:00、周六周日整天。',
      '两个数填成一样 = 不分峰谷，全天就一条线',
      '安静时段压得住谷时',
    )
  })

  await t.test('安静时段：起===止 那条是独立红字，不埋在长句子里', () => {
    要含(文0, '两个数填成一样 = 安静时段等于没开，整天都可能掷', '跨午夜也行，比如 23 到 7')
    const 单独行 = 节点们(树0).find((n) =>
      n.kids.some((k) => typeof k === 'string' && k.includes('两个数填成一样 = 安静时段等于没开')),
    )
    assert.ok(单独行, '那条提醒得是一个独立节点')
    assert.equal(单独行.p.style.color, '#c0392b', '而且要用醒目色，不是普通小字')
  })

  await t.test('冷却：0 = 不冷却，手动按钮不受它管', () => {
    要含(文0, '填 0 就是不冷却。「演练一次 / 真发一次」这两个按钮不受它管。')
  })

  // ---------------------------------------------------------------- 4
  await t.test('会话清单：一行 = 复选框 + 标题 + 尾巴号 + 状态', () => {
    const 行们 = 会话行们(树0)
    assert.equal(行们.length, 4)

    const 甲 = 找行(树0, 'sess-abc')
    assert.ok(甲, '找不到甲会话那一行')
    assert.equal(甲.kids[0].p.type, 'checkbox')
    要含(文字(甲), '甲会话', '…sess-abc · idle')
    assert.ok(甲.p.title.includes('标题来自：会话标题服务'), 甲.p.title)

    const 乙 = 找行(树0, ID_长)
    要含(文字(乙), '乙会话', '…' + ID_长.slice(-8), 'idle')
    assert.ok(!文字(乙).includes(ID_长), '长 id 只显示尾巴，不该整串铺出来')

    // 没标题的：明说「（未命名会话）」，不留白，照样能勾
    const 无名 = 找行(树0, 'sess-没名字')
    要含(文字(无名), '（未命名会话）', '…sess-没名字', '没活着')
    assert.equal(无名.kids[0].p.type, 'checkbox')
    assert.ok(无名.p.title.includes('这间现在没开'), 无名.p.title)

    // 归档的那条：只对「已经勾着」的才列出来，并且标出来
    const 归档 = 找行(树0, 'sess-归档了')
    要含(文字(归档), '⚠ 已归档')
    assert.ok(归档.p.title.includes('已经归档了，建议取消勾选'), 归档.p.title)
  })

  await t.test('清单口径：已归档的不列、没名字的照样能勾', () => {
    要含(
      文0,
      '没名字的显示「（未命名会话）」加一串号尾巴，照样能勾。',
      '已归档的不列出来（掷中也会被 DSH 拦下）',
      '✓ 勾和取消都是一点就存，不用再按保存',
    )
  })

  await t.test('摘要：已勾几个、其中几间活着', () => {
    要含(文0, '已勾 1 个', '甲会话', '其中 1 间现在活着')
  })

  // ---------------------------------------------------------------- 5
  await t.test('点一下 = 勾上，并且当场 POST /save（补丁里只有目标会话）', async () => {
    const 树 = 造槽(建态())
    assert.equal(找行(树, ID_长).kids[0].p.checked, false)
    请求 = []
    await 点(找行(树, ID_长).kids[0])
    assert.equal(要重渲染, true, '点一下要重渲染')
    await 等一拍()

    assert.equal(请求.length, 1, '一次点击只该发一个请求')
    assert.equal(请求[0].路径, 端点 + '/save')
    assert.equal(请求[0].方法, 'POST')
    assert.deepEqual(Object.keys(请求[0].体), ['目标会话'], '只发目标会话这一格，别把别的没存改动一起提交')
    assert.deepEqual(请求[0].体.目标会话, ['sess-abc', ID_长])

    const 新树 = 渲染()
    assert.equal(找行(新树, ID_长).kids[0].p.checked, true)
    assert.equal(找行(新树, 'sess-abc').kids[0].p.checked, true, '勾第二个不该把第一个挤掉')
    要含(文字(新树), '已勾 2 个', '其中 2 间现在活着')
  })

  await t.test('再点一下 = 取消，也当场存', async () => {
    const 树 = 造槽(建态({ 目标: ['sess-abc', ID_长] }))
    assert.equal(找行(树, ID_长).kids[0].p.checked, true)
    请求 = []
    await 点(找行(树, ID_长).kids[0])
    await 等一拍()
    assert.deepEqual(请求[0].体.目标会话, ['sess-abc'])
    const 新树 = 渲染()
    assert.equal(找行(新树, ID_长).kids[0].p.checked, false)
    要含(文字(新树), '已勾 1 个')
  })

  await t.test('没标题的那行点一下也能勾上（并用尾巴号在摘要里表示它）', async () => {
    const 树 = 造槽(建态())
    请求 = []
    await 点(找行(树, 'sess-没名字').kids[0])
    await 等一拍()
    assert.ok(请求[0].体.目标会话.includes('sess-没名字'))
    const 新树 = 渲染()
    assert.equal(找行(新树, 'sess-没名字').kids[0].p.checked, true)
    要含(文字(新树), '…sess-没名字', '（没活着）')
  })

  // ---------------------------------------------------------------- 6
  await t.test('一个都没勾 / 勾的全没活着：两句话说得不一样', () => {
    const 空 = 造槽(建态({ 目标: [] }))
    要含(文字(空), '一个都没勾 —— 掷中了也没地方开口')

    const 全死 = 造槽(建态({ 目标: ['sess-没名字'] }))
    要含(文字(全死), '一间都没活着 —— 这一掷会跳过去，先把会话开起来')
  })

  await t.test('清单为空时给一句人话，不摆一张空表', () => {
    const 态 = 建态()
    态.活着的会话 = []
    const 树 = 造槽(态)
    要含(文字(树), '宿主那边现在没有开着的会话')
  })

  // ---------------------------------------------------------------- 7
  await t.test('手填 id：逗号/顿号都认，按「存下这几个 id」才生效', async () => {
    const 树 = 造槽(建态())
    await 改编(输入框(树, 'text')[0], 'aaa-1, bbb-2、ccc-3')
    const 树2 = 渲染()
    请求 = []
    await 找按钮(树2, '存下这几个 id').p.onClick()
    await 等一拍()
    const 存回 = 请求.find((x) => x.路径 === 端点 + '/save')
    assert.ok(存回, '应该发了 /save')
    assert.deepEqual(存回.体.目标会话, ['aaa-1', 'bbb-2', 'ccc-3'])
    要含(文字(渲染()), '已勾 3 个')
  })

  await t.test('保存设置：脏了才出悬浮条，存完自己收起来', async () => {
    let 树 = 造槽(建态())
    assert.equal(节点们(树).filter(是浮条).length, 0, '没改动时不该有悬浮条')
    要含(文字(树), '设置已同步 ✓')

    await 改编(数字们(树)[0], '35')
    树 = 渲染()
    const 浮条们 = 节点们(树).filter(是浮条)
    assert.equal(浮条们.length, 1, '改了数字就该冒出保存条')
    要含(文字(浮条们[0]), '⚠ 有改动还没保存', '保存设置')
    要含(文字(树), '上面有改动还没保存')

    请求 = []
    const 存键 = 按钮们(浮条们[0]).find((b) => b.p.title === '保存设置')
    assert.ok(存键, '悬浮条上得有一个能点的保存按钮')
    await 存键.p.onClick()
    await 等一拍()
    assert.equal(请求.at(-1).路径, 端点 + '/save')
    assert.equal(请求.at(-1).体.间隔分钟, '35', '存下去的应该是草稿里的新值')

    const 存完 = 渲染()
    assert.equal(节点们(存完).filter(是浮条).length, 0, '存完悬浮条要收起来')
    要含(文字(存完), '设置已同步 ✓')
  })

  await t.test('保存失败：红字说清楚，而且不假装存上了', async () => {
    let 树 = 造槽(建态())
    await 改编(数字们(树)[0], '35')
    树 = 渲染()
    让保存失败 = true
    await 找按钮(树, '保存设置').p.onClick()
    await 等一拍()
    让保存失败 = false
    const 新树 = 渲染()
    要含(文字(新树), '上一次没存进去', '网络断了，还是宿主不在了')
    assert.equal(节点们(新树).filter(是浮条).length, 1, '没存上就不该把悬浮条收走')
  })

  // ---------------------------------------------------------------- 8
  await t.test('演练 / 真发 两个按钮各打各的 mode', async () => {
    let 树 = 造槽(建态())
    请求 = []
    await 找按钮(树, '演练一次（绝不发出去）').p.onClick()
    await 等一拍()
    assert.deepEqual(请求.at(-1), { 路径: 端点 + '/roll', 方法: 'POST', 体: { 模式: '演练' } })

    树 = 渲染()
    await 找按钮(树, '真发一次（不等排程）').p.onClick()
    await 等一拍()
    assert.deepEqual(请求.at(-1), { 路径: 端点 + '/roll', 方法: 'POST', 体: { 模式: '真发' } })
    要含(文字(渲染()), '已经按「真发」跑了一次')
  })

  await t.test('重读一遍 / 重读清单 → GET /state；新开一间 → POST /new-session', async () => {
    let 树 = 造槽(建态())
    请求 = []
    await 找按钮(树, '重读一遍').p.onClick()
    await 等一拍()
    assert.deepEqual([请求.at(-1).路径, 请求.at(-1).方法], [端点 + '/state', 'GET'])

    树 = 渲染()
    await 找按钮(树, '重读清单').p.onClick()
    await 等一拍()
    assert.deepEqual([请求.at(-1).路径, 请求.at(-1).方法], [端点 + '/state', 'GET'])

    树 = 渲染()
    await 找按钮(树, '新开一间并勾上').p.onClick()
    await 等一拍()
    assert.deepEqual(请求.at(-1), { 路径: 端点 + '/new-session', 方法: 'POST', 体: { 设为目标: true } })
    要含(文字(渲染()), '建好了：session-新开的')
  })

  await t.test('有请求在路上时按钮变灰（防连点）', () => {
    const 树 = 造槽(建态(), { 忙: true })
    for (const 名 of ['保存设置', '演练一次（绝不发出去）', '真发一次（不等排程）', '重读一遍', '重读清单', '新开一间并勾上']) {
      const b = 找按钮(树, 名)
      assert.ok(b, '找不到按钮：' + 名)
      assert.equal(b.p.disabled, true, `${名} 在忙的时候应该禁用`)
    }
  })

  // ---------------------------------------------------------------- 9
  await t.test('插件版本卡：三种状态三种说法', () => {
    const 有新版 = 造槽(建态(), {
      更新: { ok: true, hasUpdate: true, latest: '9.9.9', current: '2.1.0', repoUrl: 'https://github.com/Speraymer/dsh-yu-speak' },
    })
    要含(文字(有新版), '仓库那边已经到 v9.9.9', '本机 v2.1.0', 'dsh plugin --profile desktop add github:Speraymer/dsh-yu-speak', '拷走这条命令')
    assert.ok(找按钮(有新版, '拷走这条命令'), '有新版才出现拷贝按钮')

    const 最新 = 造槽(建态(), { 更新: { ok: true, hasUpdate: false, current: '2.1.0', latest: '2.1.0' } })
    要含(文字(最新), '已经是最新（v2.1.0）')
    assert.equal(找按钮(最新, '拷走这条命令'), undefined, '最新的时候不该出现拷贝按钮')

    const 没查到 = 造槽(建态(), { 更新: { ok: false, error: '断网了' } })
    要含(文字(没查到), '没问出来：断网了', '查不到不等于没事，别当成「已是最新」。')
  })

  await t.test('这个窗口不给剪贴板时，复制按钮要有话说（不是静默失败）', async () => {
    const 树 = 造槽(建态(), {
      更新: { ok: true, hasUpdate: true, latest: '9.9.9', current: '2.1.0', repoUrl: 'https://github.com/Speraymer/dsh-yu-speak' },
    })
    await 找按钮(树, '拷走这条命令').p.onClick()
    要含(文字(渲染()), '这个窗口不给剪贴板，手动选中吧')
  })

  await t.test('查更新：查着的时候按钮改成「问着呢…」并禁用', () => {
    const 树 = 造槽(建态(), { 更新: null, 查着: true })
    const b = 找按钮(树, '问着呢…')
    assert.ok(b)
    assert.equal(b.p.disabled, true)
  })

  // ---------------------------------------------------------------- 10
  await t.test('记账：一条一行，写清时间和内容；空的时候说「还没有记账」', () => {
    const 树 = 造槽(建态({ 日志: [{ 时间: '10-31 03:00:00', 文本: '已装好 v2.1.0' }] }))
    要含(文字(树), '最近 1 条记账（新的在最下面）', '10-31 03:00:00', '已装好 v2.1.0')
    const 空 = 造槽(建态({ 日志: [] }))
    要含(文字(空), '最近 0 条记账', '还没有记账。')
  })

  // ---------------------------------------------------------------- 11
  await t.test('还没读到状态：只说「在等」，不摆一张空表', () => {
    let 崩 = false
    let 树 = null
    try {
      树 = 造槽(null)
    } catch (错误) {
      崩 = true
      console.log(错误)
    }
    assert.equal(崩, false)
    要含(文字(树), '主动说话', '正在跟宿主要状态…')
    assert.equal(找按钮(树, '保存设置'), undefined, '读不到状态时不该摆出一张假表')

    // 读不到但已经有回话了 → 显示那句回话
    要含(文字(造槽(null, { 回话: '读不到宿主那边的状态 —— 插件加载了吗？' })), '读不到宿主那边的状态')
  })

  await t.test('旧形状 / 空数据：不崩，也别摆出假数据', () => {
    assert.doesNotThrow(() => 造槽({ ok: true, 配置: {} }))
    assert.doesNotThrow(() => 造槽({ ok: true, 配置: { 目标会话: [] } }))
    // 老配置里还有个 概率，不该影响渲染
    const 旧 = 造槽({
      ok: true,
      配置: { 总开关: true, 试运行: true, 目标会话: [], 间隔分钟: 30, 概率: 35, 安静起: 1, 安静止: 8, 触发文案: 'x', 角色: 'user' },
    })
    要含(文字(旧), '一个都没勾 —— 掷中了也没地方开口')
    不该含(文字(旧), '掷中概率')
  })

  await t.test('页头那句说明写清了「本地掷骰不花钱，掷中了才真走一轮」', () => {
    要含(
      文0,
      '骰子在本地掷，没掷中一分钱不花',
      '人格、历史、工具、记忆都是她自己的',
      '⚠ 掷骰是本地随机，不花模型；只有掷中之后真发，才真的会走一轮、真的会花 token。',
    )
  })
})
