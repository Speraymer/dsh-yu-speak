// tests/宿主半边.mjs —— 宿主那一半的契约测试（lib/host.js + lib/engine/*）
//
// 跑法： node --test tests/*.mjs      （Node 20+，用的是内置 node:test，不自己造断言器）
//
// 边界，先说清楚：
//   · **不装插件、不碰 DSH、不碰任何真会话**。DSH_HOME 指到系统临时目录，
//     agent / 会话 / 标题服务全是假的，followup 只往数组里塞。
//   · 能验的：默认值、归一化、峰谷判档、命中线算术、没中加成的记账口径、冷却、
//     安静时段、各种「安全的什么都不做」、消息形状、写死的那 8 格改不动、
//     followup 抛错不漏 rejection、配置坏了回默认、标题的两条来源、挑房间的加权方向。
//   · **验不了**的：真 followup 到活着的会话上会不会真开一轮（那必须在 DSH 里跑），
//     以及真机上 ctx.sessionTitle 到底给不给标题（这里喂的是假服务）。
//
// 组织方式：**一个父用例 + 一串按执行顺序排的子用例**。
// 这些用例共用一份内存状态（没中计数器、自己上次开口、上次抽中的屋子），
// 顺序本身就是被测行为的一部分，所以不做随机顺序、也不并发。
// 时间：判峰时一类**全部喂假日期**，半夜跑测试也不会红；走定时器的那几条
// 一律把安静时段设成「起===止」（= 不启用），不然断言会跟着钟点飘。

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------- 临时 DSH_HOME（配置文件和投影缓存都落在这儿）----------

const 家 = mkdtempSync(join(tmpdir(), 'yu-speak-host-'))
process.env.DSH_HOME = 家
const 配置文件 = join(家, 'speak-up-config.json')
const 旧配置文件 = join(家, 'her-words-config.json')

after(() => {
  try { rmSync(家, { recursive: true, force: true }) } catch (错误) {}
})

// ---------- 先把「投影缓存文件」铺好：标题的第二条来源 ----------
// 真机上的坐标：<DSH_HOME>/storages/session_projcache/sessions/<id>.json
// 文件名里的 id **带不带 session- 前缀两种都出现过**，所以两种都铺一份。

const ID_带前缀 = 'session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f'
const ID_裸 = 'abc12345-6789-4abc-9def-0123456789ab'
const ID_首条 = 'session-0900aa00-bb11-4cc2-8dd3-ee44ff55aa66'

const 投影目录 = join(家, 'storages', 'session_projcache', 'sessions')
mkdirSync(投影目录, { recursive: true })
const 铺投影 = (文件名, rows) =>
  writeFileSync(join(投影目录, 文件名 + '.json'), JSON.stringify({ version: 7, record: { rows } }), 'utf8')

铺投影(ID_带前缀, { title: { ver: 1, seq: 9, val: '示例会话' } })
铺投影('session-' + ID_裸, { title: { ver: 1, seq: 3, val: '裸 id 那个会话' } })
铺投影(ID_首条, { titleInput: { ver: 3, seq: 4, val: { first: { seq: 4, text: '  帮我看看这段代码有什么问题  ' } } } })

// ---------- 假的人 ----------

const 造agent = (id, 选项 = {}) => ({
  id,
  // ⚠ 故意有些 agent 不给 status：宿主把 undefined 当成「不忙」，这是个真实分支
  status: 选项.status,
  session: { id },
  收到: [],
  async followup(消息) {
    if (选项.抛错) throw new Error(选项.抛错)
    this.收到.push(消息)
  },
})

const 甲 = 造agent('sess-abc')
const 乙 = 造agent(ID_带前缀)
const 丙 = 造agent(ID_裸)
const 会炸 = 造agent('sess-会抛错', { 抛错: '模拟 followup 炸了' })
const 全体 = [甲, 乙, 丙, 会炸]

const 会话表 = new Map([
  ['sess-abc', { id: 'sess-abc' }],
  [ID_带前缀, { id: ID_带前缀 }],
  [ID_裸, { id: ID_裸 }],
  [ID_首条, { id: ID_首条 }],
  ['sess-没名字', { id: 'sess-没名字' }],
  ['sess-会抛错', { id: 'sess-会抛错' }],
  ['sess-已归档', { id: 'sess-已归档' }],
])

// ⚠ 故意只给 sess-abc 一个标题：其余全靠投影缓存文件，这样才证得明「文件那条路」真在跑
const 标题表 = new Map([['sess-abc', '甲会话']])

// ---------- 假的 ctx ----------

const 路由 = new Map()
const 定时器 = []
const 事件表 = new Map()
const 清理们 = []
/**
 * 记账次数。⚠ 不能用「日志条数涨了没」来等一轮跑完：宿主的内存日志**封顶 60 条**，
 *   跑过 60 条之后数组只 shift 不增长，长度就再也不动了。
 *   每记一条账宿主都会调一次 ctx.logger.info，所以这里数它。
 */
let 记账次数 = 0

const 假ctx = {
  agents: {
    get: (id) => 全体.find((a) => String(a.id) === String(id)),
    list: () => 全体,
  },
  // DSH 的权威归档来源
  workspaceRegistry: { archivedSessionIds: ['sess-已归档'] },
  webServer: {
    register: (r) => {
      路由.set(r.path, r.handler)
      return () => 路由.delete(r.path)
    },
  },
  interval: (cb, ms) => {
    const 一张表 = { cb, ms, 停了: false }
    定时器.push(一张表)
    return () => { 一张表.停了 = true }
  },
  logger: {
    info: () => { 记账次数 += 1 },
    warn: () => {},
    error: () => {},
  },
  effect: (fn) => {
    const 收 = fn()
    if (typeof 收 === 'function') 清理们.push(收)
  },
  on: (名, cb) => {
    if (!事件表.has(名)) 事件表.set(名, [])
    事件表.get(名).push(cb)
    return () => {}
  },
  get: (名) => {
    if (名 === 'sessions') {
      // 抄朗读桥的用法：清单用 list()，Session 对象用 get(id)
      return { list: () => [...会话表.values()], get: (id) => 会话表.get(String(id)) }
    }
    if (名 === 'sessionTitle') {
      // ⚠ 传进来的是 **Session 对象**，不是 id（真服务的用法就是这样）
      return {
        get: (会话) => {
          const id = String(会话 && 会话.id)
          return 标题表.has(id) ? { title: 标题表.get(id) } : undefined
        },
      }
    }
    if (名 === 'sessionController') {
      return {
        inspect: async () => ({ events: [] }),
        create: async () => ({ sessionId: 'sess-新建的' }),
      }
    }
    return undefined
  },
}

// 随机数：整份测试统一从这里取，`取随机` 可以随时换掉
//   · 固定 0.5 → 骰子变确定（掷值 50.0）：命中线 0 必没中、命中线 100 必中
//   · LCG 序列 → 骰子和挑房间都散开，用来验「两边都会被轮到」
let 种子 = 20261031
const 线性同余 = () => {
  种子 = (种子 * 1103515245 + 12345) % 2147483648
  return 种子 / 2147483648
}
let 取随机 = () => 0.5
const 原随机 = Math.random
Math.random = () => 取随机()

/**
 * 时间快进（毫秒偏移）。
 * ⚠ 2026-10-31 第二轮精简把「搭话冷却分钟」写死成 20 分钟之后，`/save` 已经关不掉冷却：
 *   测试里只要真发过一次，紧接着的自动滴答就会被「自己刚开过口」拦住。
 *   生产里定时器是 30 分钟一轮，本来就撞不上 20 分钟冷却 —— 所以这里在需要的时候
 *   把 Date.now 往前拨一段，模拟「下一轮排程到点了」。
 * ⚠ 只动 Date.now（`她说话` / `距上次说话` 都走它，相对距离保持一致）；
 *   `new Date()`（新表、判峰时）不受影响，峰谷断言还是按真实钟点走。
 */
let 时间偏移 = 0
const 真实now = Date.now
Date.now = () => 真实now() + 时间偏移
const 让时间过去 = (分钟) => {
  时间偏移 += 分钟 * 60 * 1000
}

const 插件 = await import('../lib/host.js')
插件.apply(假ctx)

// ---------- 小工具 ----------

const 造res = () => ({ statusCode: undefined, 体: null, writeHead() {}, end(s) { this.体 = JSON.parse(s) } })

const 调 = async (路径, body) => {
  const 方法 = 路径.endsWith('/state') || 路径.endsWith('/update') ? 'GET' : 'POST'
  const res = 造res()
  const req = {
    method: 方法,
    url: 路径,
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify(body === undefined ? {} : body))
    },
  }
  await 路由.get(路径)(req, res)
  return res.体
}

const 读状态 = () => 调('/dsh-speak-up/state')
const 存 = (补丁) => 调('/dsh-speak-up/save', 补丁)
const 掷 = (模式) => 调('/dsh-speak-up/roll', { 模式 })
const 末条 = (回复) => 回复.日志.at(-1).文本

/** 一段记账必须同时含这几段；不含就把整段打出来，别只报「不对」。 */
const 文要含 = (文, ...片段) => {
  for (const 段 of 片段) assert.ok(String(文).includes(段), `记账应含「${段}」，实际是：${文}`)
  return 文
}

/** 末条记账必须同时含这几段。 */
const 末条要含 = (回复, ...片段) => 文要含(末条(回复), ...片段)

/**
 * 拨一下定时器，等它记完账。
 * ⚠ 定时器回调是 fire-and-forget（宿主里写的就是 `void 掷一次(...)`），
 *   拿不到那个 Promise，所以看「记账次数涨了没」来等，比 sleep 40ms 稳。
 *   （不能用日志条数：内存日志封顶 60 条，涨到头就不涨了。）
 */
async function 滴答() {
  const 前 = 记账次数
  定时器.at(-1).cb()
  const 起 = Date.now()
  while (记账次数 <= 前) {
    if (Date.now() - 起 > 5000) throw new Error('定时那一轮没写记账（可能卡住了）')
    await new Promise((r) => setTimeout(r, 2))
  }
  // 让这一轮彻底收尾（.finally 里还可能换表、再记一条）
  await new Promise((r) => setTimeout(r, 0))
  return (await 读状态()).日志.at(-1).文本
}

/** 假装她刚刚（或多久以前）在某个会话里说过话。 */
function 她说话(id, 多久以前毫秒 = 0, 来源 = 'user') {
  for (const cb of 事件表.get('session/event') || []) {
    cb({ id }, { type: 'user/message', time: Date.now() - 多久以前毫秒, data: { source: { kind: 来源 } } })
  }
}

// 2026-10-19 是周一、10-23 周五、10-24 周六、10-25 周日（写死日期，不随时间漂）
const 某时 = (日, 时, 分 = 0) => new Date(2026, 9, 日, 时, 分, 0)

/**
 * 让每一次滴答都用一个空的「安静的」配置底子（安静时段关掉）。
 * ⚠ 加成上限 / 近、远阈值与因子 / 没中加成 / 搭话冷却分钟 / 角色 这 8 格**已经写死**
 *   （宿主的 `写死`），这里塞了也不生效，所以干脆不塞 —— 想验它们不被改，看下面
 *   「这 8 格写死了」那条。冷却固定在 20 分钟，真发过之后要滴答就用 `让时间过去()`。
 */
const 重置自动 = (补丁 = {}) =>
  存({
    目标会话: ['sess-abc'],
    间隔分钟: 30,
    安静起: 0,
    安静止: 0,
    试运行: true,
    峰时命中线: 100,
    谷时命中线: 100,
    ...补丁,
  })

// =====================================================================
// 用例
// =====================================================================

test('宿主半边', async (t) => {
  // ---------------------------------------------------------------- 1
  await t.test('装起来：5 条路由、30 分钟的表、默认值一字不差', async () => {
    assert.deepEqual(
      [...路由.keys()].sort(),
      ['/dsh-speak-up/new-session', '/dsh-speak-up/roll', '/dsh-speak-up/save', '/dsh-speak-up/state', '/dsh-speak-up/update'],
    )
    assert.equal(定时器.length, 1, '刚起来应该只挂了一张表')
    assert.equal(定时器[0].ms, 30 * 60 * 1000)

    const 态 = await 读状态()
    assert.equal(态.ok, true)
    assert.equal(态.版本, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    '版本号要跟 package.json 一致（别在测试里写死，一升版就红）')
    assert.deepEqual(
      {
        总开关: 态.配置.总开关,
        试运行: 态.配置.试运行,
        间隔分钟: 态.配置.间隔分钟,
        峰时命中线: 态.配置.峰时命中线,
        谷时命中线: 态.配置.谷时命中线,
        没中加成: 态.配置.没中加成,
        加成上限: 态.配置.加成上限,
        搭话冷却分钟: 态.配置.搭话冷却分钟,
        安静起: 态.配置.安静起,
        安静止: 态.配置.安静止,
        近阈值分钟: 态.配置.近阈值分钟,
        近因子: 态.配置.近因子,
        远阈值分钟: 态.配置.远阈值分钟,
        远因子: 态.配置.远因子,
        角色: 态.配置.角色,
      },
      {
        总开关: true,
        试运行: true,
        间隔分钟: 30,
        峰时命中线: 20,
        谷时命中线: 60,
        没中加成: 10,
        加成上限: 40,
        搭话冷却分钟: 20,
        安静起: 1,
        安静止: 8,
        近阈值分钟: 20,
        近因子: 0.15,
        远阈值分钟: 360,
        远因子: 1.5,
        角色: 'user',
      },
    )
    assert.deepEqual(态.配置.目标会话, [], '目标会话默认是空数组（勾选出来的形状）')
    assert.equal(态.配置.概率, undefined, '老配置里那个单独的「概率」不该再出现在快照里')
  })

  // ---------------------------------------------------------------- 2
  await t.test('会话清单与标题：两条来源 + 归档不列 + 空标题排最后', async () => {
    const 态 = await 读状态()
    const 清单 = 态.活着的会话
    const 找 = (id) => 清单.find((行) => 行.id === id)

    assert.equal(清单.length, 6, '7 个会话里那个已归档的（没勾着）不该列出来：' + 清单.map((x) => x.id).join(' '))
    assert.equal(找('sess-已归档'), undefined)

    // ① 会话标题服务：传的是 Session 对象
    assert.deepEqual(
      { 标题: 找('sess-abc').标题, 来源: 找('sess-abc').标题来源 },
      { 标题: '甲会话', 来源: '会话标题服务' },
    )
    // ② 投影缓存：id 已经带 session- 前缀 → 文件名就是原样
    assert.deepEqual(
      { 标题: 找(ID_带前缀).标题, 来源: 找(ID_带前缀).标题来源 },
      { 标题: '示例会话', 来源: '投影缓存 title' },
    )
    // ② 投影缓存：id 不带前缀 → 文件名要补前缀才找得到
    assert.equal(找(ID_裸).标题, '裸 id 那个会话')
    // ② 投影缓存：只有 titleInput → 退一步用首条输入，并去掉首尾空白
    assert.deepEqual(
      { 标题: 找(ID_首条).标题, 来源: 找(ID_首条).标题来源 },
      { 标题: '帮我看看这段代码有什么问题', 来源: '投影缓存 titleInput（第一条消息）' },
    )
    // 两条都没有 → 空串（页面负责显示「（未命名会话）」），绝不抛错
    assert.deepEqual({ 标题: 找('sess-没名字').标题, 来源: 找('sess-没名字').标题来源 }, { 标题: '', 来源: '没有' })

    // 没标题的排最后（排序不含「勾着」，勾第二个时行不会乱跳）
    assert.equal(清单[清单.length - 1].标题, '')
    assert.notEqual(清单[0].标题, '')

    // 每行都带状态 / 有没有 agent
    assert.equal(找('sess-没名字').有agent, false)
    assert.equal(找('sess-没名字').状态, '没活着')
    assert.equal(找('sess-abc').有agent, true)
  })

  // ---------------------------------------------------------------- 3
  await t.test('判峰时：周末全天谷时', () => {
    // 周六、周日挑几个「平时一定是峰时」的钟点
    for (const [日, 时, 分] of [[24, 10, 0], [24, 15, 30], [25, 10, 0], [25, 16, 0]]) {
      assert.equal(插件.判峰时(某时(日, 时, 分)), false, `10-${日} ${时}:${分} 应该算谷时（周末全天）`)
    }
  })

  await t.test('判峰时：工作日午休谷时', () => {
    for (const 钟点 of [[12, 0], [12, 59], [13, 0], [13, 59]]) {
      assert.equal(插件.判峰时(某时(19, 钟点[0], 钟点[1])), false, `周一 ${钟点[0]}:${钟点[1]} 是午休，谷时`)
    }
  })

  await t.test('判峰时：整点边界（含起不含止）', () => {
    const 表 = [
      [8, 59, false], // 还没到 9 点
      [9, 0, true], // 起点算峰
      [11, 59, true],
      [12, 0, false], // 终点算谷
      [13, 59, false],
      [14, 0, true], // 下午起点
      [17, 59, true],
      [18, 0, false], // 终点算谷
      [22, 0, false],
      [3, 0, false],
    ]
    for (const [时, 分, 期望] of 表) {
      assert.equal(插件.判峰时(某时(19, 时, 分)), 期望, `周一 ${时}:${分}`)
    }
  })

  await t.test('判峰时：周五仍是工作日、周一是工作日，都按同一套窗口', () => {
    assert.equal(插件.判峰时(某时(23, 10, 0)), true, '周五 10:00 = 峰时')
    assert.equal(插件.判峰时(某时(23, 18, 0)), false, '周五 18:00 = 谷时')
    assert.equal(插件.判峰时(某时(19, 10, 0)), true, '周一 10:00 = 峰时')
    assert.equal(插件.判峰时(某时(19, 14, 30)), true, '周一 14:30 = 峰时')
    assert.equal(插件.判峰时(某时(19, 0, 0)), false, '周一 00:00 = 谷时')
  })

  await t.test('判峰时：「现在」可以从外面喂，不传就是现在', () => {
    assert.equal(typeof 插件.判峰时(), 'boolean')
    // 同一个时刻用 Date 和用时间戳喂进来，结果要一样（内部会 new Date 一次）
    const 表 = 某时(19, 10)
    assert.equal(插件.判峰时(表.getTime()), 插件.判峰时(表))
  })

  // ---------------------------------------------------------------- 4
  await t.test('算基础命中线：峰时用峰时那格、谷时用谷时那格', () => {
    const 假配置 = { 峰时命中线: 20, 谷时命中线: 60 }
    assert.deepEqual(插件.算基础命中线(假配置, 某时(19, 10)), {
      峰: true,
      基础命中线: 20,
      短语: '峰时命中线 20%',
    })
    assert.deepEqual(插件.算基础命中线(假配置, 某时(19, 13)), {
      峰: false,
      基础命中线: 60,
      短语: '谷时命中线 60%',
    })
    // 周末 10:00 看着像峰时点，但周末全天谷时 → 用谷时那格
    assert.equal(插件.算基础命中线(假配置, 某时(24, 10)).基础命中线, 60)
  })

  // ---------------------------------------------------------------- 5
  await t.test('算命中线：先乘因子、再加没中加成（顺序不能反）', () => {
    // 谷时 60 × 近因子 0.15 = 9，再 +10 → 19。
    // 如果写成 (60 + 10) × 0.15 会得到 10.5 —— 这一条就是拿来卡顺序的
    assert.deepEqual(插件.算命中线(60, 0.15, 1, 10, 40), { 加成: 10, 线: 19 })
    // 因子 1.5 也照乘：40 × 1.5 = 60，再加 20 → 80
    assert.deepEqual(插件.算命中线(40, 1.5, 2, 10, 40), { 加成: 20, 线: 80 })
  })

  await t.test('算命中线：加成封顶、没中加成 0 等于关掉', () => {
    assert.deepEqual(插件.算命中线(20, 1, 2, 10, 40), { 加成: 20, 线: 40 })
    assert.deepEqual(插件.算命中线(20, 1, 3, 10, 25), { 加成: 25, 线: 45 }, '3×10 被上限 25 卡住')
    assert.deepEqual(插件.算命中线(20, 1, 9, 10, 25), { 加成: 25, 线: 45 }, '攒再多次也不会超过上限')
    assert.deepEqual(插件.算命中线(20, 1, 7, 0, 40), { 加成: 0, 线: 20 }, '没中加成 0 = 一分不加')
    assert.deepEqual(插件.算命中线(20, 1, 0, 10, 40), { 加成: 0, 线: 20 }, '掷中之后连没中=0，回到基础')
  })

  await t.test('算命中线：结果夹在 0~100', () => {
    assert.equal(插件.算命中线(95, 1, 3, 10, 40).线, 100, '95+20 要夹到 100')
    assert.equal(插件.算命中线(100, 1.5, 0, 10, 40).线, 100, '150 要夹到 100')
    const 很小 = 插件.算命中线(2, 0.15, 0, 10, 40).线
    assert.ok(很小 > 0.29 && 很小 < 0.31, '小因子不会被莫名抬高，实际：' + 很小)
    assert.equal(插件.算命中线(0, 0.1, 3, 10, 40).线, 30, '基础线是 0，加成照样加得上')
    assert.equal(插件.算命中线(5, -1, 0, 0, 40).线, 0, '负数要夹到 0（防御性，配置层已经夹过）')
  })

  // ---------------------------------------------------------------- 6
  await t.test('挑房间 · 沉寂加成：越冷越高，最多 4 倍，不明给 2 倍', async () => {
    const 挑 = await import('../lib/engine/挑房间.mjs')
    assert.equal(挑.沉寂加成(0), 1, '刚说过话 → 不加成')
    assert.equal(挑.沉寂加成(30), 2, '30 分钟 → 一档')
    assert.equal(挑.沉寂加成(90), 3, '90 分钟 → log2(4)=2 → 3 倍')
    assert.equal(挑.沉寂加成(100000), 4, '再冷也封顶 4 倍')
    assert.equal(挑.沉寂加成(undefined), 2, '读不到沉寂 → 按中等偏冷给 2 倍')
    assert.equal(挑.沉寂加成(null), 2)
    // 单调：更冷的屋子权重只会更大
    assert.ok(挑.沉寂加成(45) < 挑.沉寂加成(120))
  })

  await t.test('挑房间 · 看一间：归档 / 没活着 / 忙 三种都拦住', async () => {
    const 挑 = await import('../lib/engine/挑房间.mjs')
    const 归档 = new Set(['s'])
    const 找 = (a) => (id) => (id === 's' ? a : undefined)

    assert.equal(挑.看一间({ id: 's', 找agent: 找(undefined), 归档, 沉寂: 0 }).原因, '已归档')
    assert.equal(挑.看一间({ id: 's', 找agent: 找(undefined), 归档: new Set(), 沉寂: 0 }).原因, '没活着')
    assert.equal(
      挑.看一间({ id: 's', 找agent: 找({ status: 'running' }), 归档: new Set(), 沉寂: 0 }).原因,
      '忙',
    )
    const 好 = 挑.看一间({ id: 's', 找agent: 找({ status: 'idle' }), 归档: new Set(), 沉寂: 90 })
    assert.equal(好.原因, undefined)
    assert.equal(好.权重, 3)
    // status 没给的 agent 也当成能用（宿主那边就是这么判的）
    assert.ok(挑.看一间({ id: 's', 找agent: 找({}), 归档: new Set(), 沉寂: undefined }).权重 > 0)
  })

  await t.test('挑房间 · 抽一间：权重大的占更大区间（喂固定随机数看方向）', async () => {
    const 挑 = await import('../lib/engine/挑房间.mjs')
    const 可用 = [
      { id: '热', agent: {}, 沉寂: 0, 权重: 挑.沉寂加成(0) }, // 1
      { id: '冷', agent: {}, 沉寂: 700, 权重: 挑.沉寂加成(700) }, // 4（封顶）
    ]
    assert.equal(可用[1].权重, 4)

    // 扫一遍 [0,1) 看两间各占多少区间：冷的是 4/5，热的是 1/5
    let 选中冷 = 0
    let 选中热 = 0
    for (let i = 0; i < 100; i++) {
      const 抽 = 挑.抽一间({ 可用, 上次抽中: null, 现在: 1, 随机: () => i / 100 })
      if (抽.选中.id === '冷') 选中冷 += 1
      else if (抽.选中.id === '热') 选中热 += 1
    }
    assert.equal(选中冷 + 选中热, 100)
    assert.ok(选中冷 > 选中热 * 3, `冷的那间（权重 4）应该吃掉大部分区间，实际冷 ${选中冷} / 热 ${选中热}`)

    // 中点：加权时落在冷的区间里；等概率时这个点会落在热上 —— 方向就在这里
    const 中点 = 挑.抽一间({ 可用, 上次抽中: null, 现在: 1, 随机: () => 0.5 })
    assert.equal(中点.选中.id, '冷')
    assert.equal(中点.权重表.find((x) => x.id === '冷').权重, 4)
  })

  await t.test('挑房间 · 抽一间：刚抽中过的屋子打 0.4 折，过期就不打', async () => {
    const 挑 = await import('../lib/engine/挑房间.mjs')
    const 可用 = [
      { id: 'A', agent: {}, 沉寂: 90, 权重: 3 },
      { id: 'B', agent: {}, 沉寂: 90, 权重: 3 },
    ]
    const 现在 = 1_000_000_000
    const 刚抽 = 挑.抽一间({ 可用, 上次抽中: { id: 'A', 时间: 现在 - 60_000 }, 现在, 随机: () => 0.5 })
    const A = 刚抽.权重表.find((x) => x.id === 'A')
    const B = 刚抽.权重表.find((x) => x.id === 'B')
    assert.equal(A.权重, 3 * 0.4)
    assert.equal(A.刚抽过, true)
    assert.equal(B.权重, 3)
    assert.equal(B.刚抽过, false)
    // 超过换手冷却（30 分钟）就不再打折
    const 久了 = 挑.抽一间({ 可用, 上次抽中: { id: 'A', 时间: 现在 - 31 * 60_000 }, 现在, 随机: () => 0.5 })
    assert.equal(久了.权重表.find((x) => x.id === 'A').权重, 3)
    // 空清单不炸
    assert.deepEqual(挑.抽一间({ 可用: [], 上次抽中: null, 现在, 随机: () => 0.5 }), { 选中: null, 权重表: [] })
  })

  await t.test('挑房间 · 说明权重：把「凭什么挑这间」写成人话', async () => {
    const 挑 = await import('../lib/engine/挑房间.mjs')
    const 行 = 挑.说明权重([
      { id: 'a', 沉寂: 90, 权重: 3, 刚抽过: false },
      { id: 'b', 沉寂: undefined, 权重: 2, 刚抽过: true },
    ])
    assert.ok(行.includes('a：90 分钟没说话，权重 3.00'), 行)
    assert.ok(行.includes('b：沉寂不明，权重 2.00（刚抽过，打折）'), 行)
  })

  // ---------------------------------------------------------------- 7
  await t.test('标题 / 送一句 两个小模块自己的算术', async () => {
    const 标题 = await import('../lib/engine/标题.mjs')
    assert.equal(标题.压成一行('  甲\n\n  乙  '), '甲 乙', '换行和多余空白要压成一行')
    assert.equal(标题.压成一行('   '), '')
    const 长 = 标题.压成一行('一'.repeat(30))
    assert.equal(长.length, 24)
    assert.ok(长.endsWith('…'))
    assert.deepEqual(标题.文件名候选(ID_带前缀), [ID_带前缀, ID_带前缀.slice('session-'.length)])
    assert.deepEqual(标题.文件名候选('abc'), ['abc', 'session-abc'])

    const 送 = await import('../lib/engine/送一句.mjs')
    const 消息 = 送.手搓消息('晚上好', 'speak-up')
    assert.equal(消息.role, 'user')
    assert.equal(消息.source.kind, 'speak-up')
    assert.equal(消息.content[0].type, 'text')
    assert.equal(消息.content[0].text, '晚上好')
    assert.equal(typeof 消息.id, 'string')
    assert.ok(消息.id.length > 0)

    const 没followup = await 送.送一句({ agent: {}, 文案: 'x', 源标记: 'speak-up' })
    assert.equal(没followup.ok, false)
    assert.ok(没followup.错误.includes('followup'))
  })

  // ---------------------------------------------------------------- 8
  await t.test('一个目标都没勾 / 勾了全不能说话 → 什么都不做', async () => {
    const 空 = await 掷('真发')
    assert.equal(甲.收到.length, 0)
    末条要含(空, '还没勾')

    // 不存在的 id：没有 agent
    存({ 目标会话: ['sess-不存在'] })
    const 没活 = await 掷('真发')
    assert.equal(甲.收到.length, 0)
    末条要含(没活, '都不能说话', '没活着')

    // 归档的：有 agent 也要拦住（往废纸篓里说不算）
    存({ 目标会话: ['sess-已归档'] })
    const 归档回 = await 掷('真发')
    末条要含(归档回, '都不能说话', '已归档')

    // 在忙：status 不是 idle
    乙.status = 'running'
    存({ 目标会话: [ID_带前缀] })
    const 忙回 = await 掷('真发')
    assert.equal(乙.收到.length, 0)
    末条要含(忙回, '都不能说话', '忙')
    乙.status = undefined
  })

  // ---------------------------------------------------------------- 8.5
  // ⚠ 这条必须排在**任何一次抽房间之前**：那之后「上次抽中的屋子」会带 0.4 折，
  //   权重就不再是教材上的 1 : 2，这条断言的推理会失效。
  // ⚠ 用「演练」而不是「真发」：真发会把「自己上次开口」写成现在，冷却又是写死的 20 分钟，
  //   后面一串滴答用例就全被拦住了。演练同样走挑房间那条路，日志里带着「这次挑 谁」。
  await t.test('多目标：沉寂久的那间权重更高（喂固定随机数看方向，不看具体选谁）', async () => {
    // 甲刚刚说过话 → 沉寂≈0 → 权重 1；乙读不到沉寂 → 权重 2。
    // 随机 0.4：总权重 3，点 = 1.2 → 甲的 1 扣完还剩 0.2 → 落到乙。
    // 若按等概率（各 1），同一个 0.4 会落在甲 —— 这一条卡的就是「加权」这个方向。
    await 重置自动({ 目标会话: ['sess-abc', ID_带前缀] })
    她说话('sess-abc', 0)
    取随机 = () => 0.4
    甲.收到.length = 0
    乙.收到.length = 0
    const 回 = await 掷('演练')
    末条要含(回, '这次挑 ' + ID_带前缀.slice(-8), '演练')
    assert.equal(甲.收到.length + 乙.收到.length, 0, '演练一个字都不发')
    取随机 = () => 0.5
  })

  // ---------------------------------------------------------------- 9
  await t.test('保存：字符串洗成数字、超范围夹住、写盘', async () => {
    const 回 = await 存({
      目标会话: ['sess-abc'],
      间隔分钟: '7',
      峰时命中线: '150',
      谷时命中线: '-5',
      没中加成: '999',
      搭话冷却分钟: 'abc',
      安静起: 0,
      安静止: 0,
    })
    assert.equal(回.ok, true)
    assert.equal(回.配置.间隔分钟, 7, '字符串数字要洗成数字')
    assert.equal(回.配置.峰时命中线, 100, '150 夹到 100')
    assert.equal(回.配置.谷时命中线, 0, '-5 夹到 0')
    assert.equal(回.配置.没中加成, 10, '这一格写死了，999 不生效')
    assert.equal(回.配置.搭话冷却分钟, 20, '这一格也写死了，坏值照旧是 20')
    assert.equal(回.配置.安静起, 0)
    assert.equal(回.配置.安静止, 0)

    assert.ok(existsSync(配置文件), '保存要落盘')
    assert.deepEqual(JSON.parse(readFileSync(配置文件, 'utf8')).目标会话, ['sess-abc'])
  })

  // --- 2026-10-31 两轮精简：这 8 格从设置页拿掉了，值写死在宿主的 `写死` 里 ---
  // ⚠ 键名还在（记账文案和 /state 还在读），所以这里验的是**值不可改**：
  //   /save 塞进去、config.json 手改，读回来都必须是常量。
  await t.test('这 8 格写死了：/save 塞别的值也不生效，读回来仍是常量', async () => {
    const 想改 = {
      加成上限: 99,
      近阈值分钟: 1,
      近因子: 9,
      远阈值分钟: 2,
      远因子: 7,
      没中加成: 77,
      搭话冷却分钟: 1,
      角色: 'developer',
    }
    const 常量 = {
      加成上限: 40,
      近阈值分钟: 20,
      近因子: 0.15,
      远阈值分钟: 360,
      远因子: 1.5,
      没中加成: 10,
      搭话冷却分钟: 20,
      角色: 'user',
    }
    /** 只摘这 8 个键，别的字段（版本、日志…）不参与比较。 */
    const 取写死那几格 = (配置) => Object.fromEntries(Object.keys(常量).map((k) => [k, 配置[k]]))

    const 存回 = await 存({ 目标会话: ['sess-abc'], ...想改 })
    assert.equal(存回.ok, true)
    assert.deepEqual(取写死那几格(存回.配置), 常量, '/save 改不动这 8 格')

    // 落盘的文件里也是常量（不然下一次读回来还得再盖一遍，两边会漂）
    const 盘上 = JSON.parse(readFileSync(配置文件, 'utf8'))
    assert.deepEqual(取写死那几格(盘上), 常量)

    // 手改 config.json 也一样被盖掉
    writeFileSync(配置文件, JSON.stringify({ ...想改, 目标会话: ['sess-abc'] }), 'utf8')
    const 态 = await 读状态()
    assert.deepEqual(取写死那几格(态.配置), 常量, 'config.json 手写别的值也读不进去')

    // 沙箱状态恢复成后面用例能用的样子（勾好目标会话）
    await 存({ 目标会话: ['sess-abc'] })
  })

  await t.test('保存：老形状（字符串、带分隔符）洗成去重数组；目标情况标出活着没', async () => {
    writeFileSync(配置文件, JSON.stringify({ 目标会话: 'sess-abc, ' + ID_带前缀 + '，sess-abc' }), 'utf8')
    const 态 = await 读状态()
    assert.deepEqual(态.配置.目标会话, ['sess-abc', ID_带前缀], '去重、保序')
    assert.equal(态.目标情况.length, 2)
    assert.ok(态.目标情况.every((x) => x.活着 === true))
    assert.equal(态.目标活着, true)
  })

  await t.test('保存：改过名的峰/谷老键还读得出来；冷却的旧键已经作废', async () => {
    writeFileSync(配置文件, JSON.stringify({ 峰时概率: 33, 谷时概率: 44, 目标会话: ['sess-abc'] }), 'utf8')
    const 旧键 = await 读状态()
    assert.equal(旧键.配置.峰时命中线, 33)
    assert.equal(旧键.配置.谷时命中线, 44)

    // 「自己开口冷却分钟」是「搭话冷却分钟」的老名字；这一格写死成 20 之后，旧键也不读了
    writeFileSync(配置文件, JSON.stringify({ 自己开口冷却分钟: 7, 目标会话: ['sess-abc'] }), 'utf8')
    assert.equal((await 读状态()).配置.搭话冷却分钟, 20, '冷却写死了，老键名也不再读')
  })

  await t.test('保存：已经作废的「概率」键被丢掉，两格回默认', async () => {
    writeFileSync(配置文件, JSON.stringify({ 概率: 80, 目标会话: ['sess-abc'] }), 'utf8')
    const 态 = await 读状态()
    assert.equal(态.配置.峰时命中线, 20)
    assert.equal(态.配置.谷时命中线, 60)
    assert.equal(态.配置.概率, undefined)
  })

  await t.test('保存：新文件不在时退回旧的 her-words-config.json（改名搬家）', async () => {
    rmSync(配置文件, { force: true })
    writeFileSync(旧配置文件, JSON.stringify({ 目标会话: ['sess-abc'], 间隔分钟: 77, 峰时命中线: 12, 谷时命中线: 34 }), 'utf8')
    const 态 = await 读状态()
    assert.equal(态.配置.间隔分钟, 77)
    assert.equal(态.配置.峰时命中线, 12)
    assert.equal(态.配置.谷时命中线, 34)
    rmSync(旧配置文件, { force: true })
  })

  // ---------------------------------------------------------------- 10
  await t.test('时机因子：近 / 中 / 远 三段都按因子乘进命中线', async () => {
    // ⚠ 阈值和因子现在写死在宿主的 `写死` 里（20 分钟 ×0.15 / 360 分钟 ×1.5），
    //   这条正好拿它们的**常量值**当断言：哪天常量被人改了，这里会红。
    // ⚠ 「没中加成」也写死成 10 了，关不掉 —— 所以这里把骰子固定成极小值（掷出 1.0），
    //   每次都掷中、计数器一直是 0，命中线才会正好等于「基础线 × 因子」。
    取随机 = () => 0.01
    她说话('sess-abc', 60 * 60 * 1000) // 1 小时前 → 中间那段，因子 1
    await 重置自动({ 峰时命中线: 40, 谷时命中线: 40 })

    她说话('sess-abc', 0) // 刚说过话
    let 文 = await 滴答()
    assert.ok(文.includes('命中线 6.0'), '40 × 0.15 = 6.0，实际：' + 文)
    assert.ok(文.includes('时机因子 0.15（'), 文)

    她说话('sess-abc', 7 * 3600 * 1000) // 7 小时没说话 → 远因子
    文 = await 滴答()
    assert.ok(文.includes('命中线 60.0'), '40 × 1.5 = 60.0，实际：' + 文)
    assert.ok(文.includes('时机因子 1.5（'), 文)

    她说话('sess-abc', 60 * 60 * 1000) // 1 小时 → 两头都不沾
    文 = await 滴答()
    assert.ok(文.includes('命中线 40.0'), 文)
    assert.ok(文.includes('时机因子 1（'), '中间那段因子是 1，实际：' + 文)
    取随机 = () => 0.5
  })

  await t.test('峰谷：记账里那一档和它算出来的线必须是同一档', async () => {
    await 重置自动({ 峰时命中线: 30, 谷时命中线: 70 })
    const 文 = await 滴答()
    const 说峰 = 文.includes('峰时命中线 30%')
    const 说谷 = 文.includes('谷时命中线 70%')
    assert.notEqual(说峰, 说谷, '必须恰好命中一档，实际：' + 文)
    if (说峰) assert.ok(文.includes('命中线 30.0'), '说峰时就得用 30 算，实际：' + 文)
    else assert.ok(文.includes('命中线 70.0'), '说谷时就得用 70 算，实际：' + 文)
    // 顺带跟纯函数对一下（同一时刻、同一套规则）
    const 现在 = new Date()
    const 期望档 = 插件.判峰时(现在) ? '峰时' : '谷时'
    assert.ok(文.includes(期望档), `现在应该是${期望档}，实际：` + 文)
  })

  // ---------------------------------------------------------------- 11
  await t.test('自动掷骰：没中一次就 +1（日志带「下次命中线变」），掷中就清零', async () => {
    她说话('sess-abc', 60 * 60 * 1000) // 因子固定 1
    // 「没中加成」写死成 10（+10/次、上限 40），页面和 /save 都改不动
    await 重置自动({ 峰时命中线: 100, 谷时命中线: 100 })
    // 命中线 100 → 必中，先把计数器清干净
    let 文 = await 滴答()
    assert.ok(文.includes('掷中 ✓'), '命中线 100 应该必中，实际：' + 文)

    await 存({ 峰时命中线: 0, 谷时命中线: 0 })
    // ① 第一次没中：加成 0 → 下次 10.0
    文 = await 滴答()
    文要含(文, '没掷中 ✗', '（命中线 0.0 —— 要掷到 0.0 以下才开口）', '下次命中线变 10.0（没中加成 +10）')
    // ② 第二次没中：这一轮的等式里要看到 +10，下次 20.0
    文 = await 滴答()
    assert.ok(文.includes('没中加成 10.0'), '第二次没中时等式里应有 +10，实际：' + 文)
    assert.ok(文.includes('下次命中线变 20.0'), '下次该是 20.0，实际：' + 文)
    // ③ 第三次没中：+20，下次 30.0（证明是一次次加上去的）
    文 = await 滴答()
    assert.ok(文.includes('没中加成 20.0'), 文)
    assert.ok(文.includes('下次命中线变 30.0'), 文)

    // ④ 掷中（试运行里掷中算）→ 清零，并且报出「之前连着几次」
    await 存({ 峰时命中线: 100, 谷时命中线: 100 })
    文 = await 滴答()
    assert.ok(文.includes('掷中 ✓'), 文)
    assert.ok(文.includes('没中加成清零（之前连着 3 次没中）'), '应报之前连着 3 次，实际：' + 文)

    // ⑤ 清零之后再没中 → 又从 10.0 开始（真的回到一开始）
    await 存({ 峰时命中线: 0, 谷时命中线: 0 })
    文 = await 滴答()
    assert.ok(文.includes('下次命中线变 10.0'), '清零后应该从 +10 重新攒，实际：' + 文)
  })

  await t.test('没中加成写死了：/save 填 0 不生效，记账照样按 +10 走', async () => {
    const 回 = await 存({ 峰时命中线: 0, 谷时命中线: 0, 没中加成: 0 })
    assert.equal(回.配置.没中加成, 10, '这一格写死了，填 0 也盖不掉')
    const 文 = await 滴答()
    assert.ok(文.includes('没中加成 +10'), '写死之后只会走 +10 那条，实际：' + 文)
    assert.ok(!文.includes('没中加成关着'), '「关着」那条分支已经不可达（只留作防御），实际：' + 文)
  })

  // ---------------------------------------------------------------- 12
  await t.test('手动按钮（演练/真发）不掷骰子、不动「连没中」计数器', async () => {
    // 先把计数器清干净，再亲手攒 1 次没中 —— 这样「没被动过」才看得出来
    await 重置自动({ 峰时命中线: 100, 谷时命中线: 100 })
    let 文 = await 滴答()
    assert.ok(文.includes('掷中 ✓'), '先掷中一次把计数器清零，实际：' + 文)
    await 存({ 峰时命中线: 0, 谷时命中线: 0 })
    文 = await 滴答()
    文要含(文, '下次命中线变 10.0')

    甲.收到.length = 0
    const 演练回 = await 掷('演练')
    assert.equal(甲.收到.length, 0, '演练绝不真发')
    末条要含(演练回, '【手动/演练】', '不动没中加成')

    甲.收到.length = 0
    const 真发回 = await 掷('真发')
    assert.equal(甲.收到.length, 1, '真发要真送到')
    末条要含(真发回, '【手动/真发】', '不动没中加成', '已送出一句')

    // 关键：上面两下都没动计数器 —— 下一次自动掷中时「之前连着」还得是 1。
    // ⚠ 真发把「自己上次开口」写成了现在，冷却写死 20 分钟，所以先把钟拨过冷却
    //   （生产里下一轮排程本来就在 30 分钟后，撞不上）。
    让时间过去(21)
    await 重置自动({ 峰时命中线: 100, 谷时命中线: 100 })
    文 = await 滴答()
    assert.ok(文.includes('掷中 ✓'), 文)
    assert.ok(
      文.includes('没中加成清零（之前连着 1 次没中）'),
      '手动点过两次之后，计数器应该还是 1，实际：' + 文,
    )
  })

  // ---------------------------------------------------------------- 13
  await t.test('搭话冷却写死 20 分钟：真发之后自动那轮被拦，/save 改不动', async () => {
    await 重置自动()

    // ① 手动真发不受冷却限制（这时「自己上次开口」刚被前面的真发写成现在）
    甲.收到.length = 0
    const 手 = await 掷('真发')
    assert.equal(甲.收到.length, 1)
    末条要含(手, '已送出一句')

    // ② 紧接着自动那一轮 → 应该在冷却里
    const 文 = await 滴答()
    assert.ok(文.includes('自己刚开过口'), '真发之后自动那轮要被拦住，实际：' + 文)
    assert.ok(文.includes('冷却 20 分钟'), '冷却现在是宿主常量 20，实际：' + 文)
    assert.ok(!文.includes('掷中'), '被冷却拦住就不该再掷骰子，实际：' + 文)

    // ③ 这一格写死了：/save 塞 0（以前是「不冷却」）或别的值都不生效
    for (const 想改 of [0, 30, 'abc']) {
      const 回 = await 存({ 搭话冷却分钟: 想改 })
      assert.equal(回.配置.搭话冷却分钟, 20, `/save 塞 ${想改} 也不该改掉冷却`)
    }
    assert.equal((await 读状态()).配置.搭话冷却分钟, 20)

    // ④ 过了冷却就不再拦（把钟往前拨 21 分钟 —— 生产里下一轮排程也是这样过去的）
    让时间过去(21)
    const 文2 = await 滴答()
    assert.ok(!文2.includes('自己刚开过口'), '过了冷却不该再拦，实际：' + 文2)
    assert.ok(文2.includes('掷中') || 文2.includes('没掷中'), 文2)
  })

  // ---------------------------------------------------------------- 14
  await t.test('多目标：一次只挑一间开口，且两边都会被轮到', async () => {
    await 重置自动({
      目标会话: ['sess-abc', ID_带前缀],
      峰时命中线: 100,
      谷时命中线: 100,
    })
    甲.收到.length = 0
    乙.收到.length = 0
    const 首 = await 掷('真发')
    末条要含(首, '这次挑', '已送出一句')
    assert.equal(甲.收到.length + 乙.收到.length, 1, '一次掷中只在一间里开口（不是群发）')

    // 换成会散开的随机序列，跑够次数：两边都该被轮到
    取随机 = 线性同余
    let 发甲 = 0
    let 发乙 = 0
    for (let i = 0; i < 40; i++) {
      甲.收到.length = 0
      乙.收到.length = 0
      await 掷('真发')
      发甲 += 甲.收到.length
      发乙 += 乙.收到.length
    }
    assert.equal(发甲 + 发乙, 40, '每次只发一个')
    assert.ok(发甲 > 0 && 发乙 > 0, `两间都该轮到，实际 甲 ${发甲} / 乙 ${发乙}`)
    取随机 = () => 0.5
  })

  // ---------------------------------------------------------------- 15
  // ⚠ 这条原来验的是「填 developer → 主动拒发并记账」。现在 `角色` 写死成 'user'
  //   （设置页也没有那一格了），那条守卫**不可达**，所以改成验相反的事：
  //   塞 developer 进去不生效，这一轮照常真发 —— 不会莫名其妙静默不发。
  await t.test('角色写死 user：/save 塞 developer 也不生效，照常真发', async () => {
    await 重置自动({ 角色: 'developer' })
    assert.equal((await 读状态()).配置.角色, 'user', '归一化必须把角色盖回 user')

    甲.收到.length = 0
    const 回 = await 掷('真发')
    assert.equal(甲.收到.length, 1, '角色被盖成 user 之后应该照常发出去')
    末条要含(回, '已送出一句')
    assert.ok(!末条(回).includes('developer'), '不该再出现 developer 那一套话：' + 末条(回))
  })

  await t.test('总开关关着：定时那一轮直接返回', async () => {
    await 重置自动({ 总开关: false })
    const 文 = await 滴答()
    assert.ok(文.includes('总开关'), 文)
    await 存({ 总开关: true })
  })

  await t.test('安静时段：起止之内不掷；起 === 止 = 不启用', async () => {
    // 前面几条真发用例把「自己上次开口」写成了现在，冷却又写死 20 分钟 —— 先过掉它
    让时间过去(21)
    const 小时 = new Date().getHours()
    await 重置自动({ 安静起: 小时, 安静止: (小时 + 1) % 24 })
    let 文 = await 滴答()
    assert.ok(文.includes('安静时段'), '当前小时落在安静时段里，应该被拦，实际：' + 文)

    await 存({ 安静起: 小时, 安静止: 小时 })
    文 = await 滴答()
    assert.ok(!文.includes('安静时段'), '起 === 止 就是不启用，实际：' + 文)
    assert.ok(文.includes('掷中') || 文.includes('没掷中'), 文)

    // 跨午夜（23~7）：起 > 止 那条分支怎么走，按「现在几点」推一遍再断言。
    // ⚠ 宿主没有把「在安静时段」导出来，也没法喂假时间，所以这里只能断言**当前小时**的结果 ——
    //   但它不是空断言：逻辑写成单向区间（小时 >= 起 && 小时 < 止）时，凌晨跑就会红。
    await 存({ 安静起: 23, 安静止: 7 })
    const 此刻 = new Date().getHours()
    const 该被拦 = 此刻 >= 23 || 此刻 < 7
    文 = await 滴答()
    assert.equal(文.includes('安静时段'), 该被拦, `现在是 ${此刻} 点，跨午夜时段 23~7 ${该被拦 ? '应该' : '不该'}拦住，实际：${文}`)

    await 存({ 安静起: 0, 安静止: 0 })
  })

  // ---------------------------------------------------------------- 16
  await t.test('followup 抛错：记一条账就不管，不留未处理的 rejection', async () => {
    const 未处理 = []
    const 记 = (错) => 未处理.push(错)
    process.on('unhandledRejection', 记)
    try {
      await 重置自动({ 目标会话: ['sess-会抛错'], 试运行: false })
      const 回 = await 掷('真发')
      assert.equal(回.ok, true, '路由本身不该被这次失败带崩')
      末条要含(回, 'followup 失败：模拟 followup 炸了')
      // 等两轮事件循环，真有漏出来的 rejection 这会儿就浮上来了
      await new Promise((r) => setTimeout(r, 80))
      assert.deepEqual(未处理, [], '不许有未处理的 rejection（Node 22+ 会直接带走宿主）')
    } finally {
      process.off('unhandledRejection', 记)
    }
  })

  // ---------------------------------------------------------------- 17
  await t.test('配置文件坏掉：回默认值，不抛错，设置页还能打开', async () => {
    writeFileSync(配置文件, '{ 这不是 json', 'utf8')
    const 态 = await 读状态()
    assert.equal(态.ok, true)
    assert.equal(态.配置.间隔分钟, 30)
    assert.equal(态.配置.峰时命中线, 20)
    assert.ok(Array.isArray(态.活着的会话))

    // 坏文件也照常能存回去
    const 回 = await 存({ 目标会话: ['sess-abc'] })
    assert.equal(回.ok, true)
    assert.deepEqual(回.配置.目标会话, ['sess-abc'])
  })

  await t.test('改间隔 → 立刻换表（不用重启插件）', async () => {
    const 表数 = 定时器.length
    await 存({ 间隔分钟: 5 })
    assert.equal(定时器.length, 表数 + 1, '改完要重挂一张表')
    assert.equal(定时器.at(-1).ms, 5 * 60 * 1000)
    await 存({ 间隔分钟: 30 })
    assert.equal(定时器.at(-1).ms, 30 * 60 * 1000)
  })

  await t.test('新建小屋：是「追加」勾上，不覆盖原来勾的', async () => {
    await 存({ 目标会话: ['sess-abc'] })
    const 回 = await 调('/dsh-speak-up/new-session', { 设为目标: true })
    assert.equal(回.新会话, 'sess-新建的')
    assert.deepEqual(回.配置.目标会话, ['sess-abc', 'sess-新建的'])
    await 存({ 目标会话: ['sess-abc'] })
  })

  await t.test('路由只认自己那个方法（GET 的 /state 不接受 POST）', async () => {
    const 处理 = 路由.get('/dsh-speak-up/state')
    const res = 造res()
    await 处理(
      {
        method: 'POST',
        url: '/dsh-speak-up/state',
        headers: {},
        [Symbol.asyncIterator]: async function* () { yield Buffer.from('{}') },
      },
      res,
    )
    assert.equal(res.体.ok, false)
    assert.ok(res.体.说.includes('只接受 GET'))
  })

  // ---------------------------------------------------------------- 18
  await t.test('没有 sessionTitle 服务时，标题照样从投影缓存读出来', async () => {
    // 换一个模块实例（带 query 强制重新求值），这样标题器也是新的一份、不是上文的缓存
    const 插件2 = await import('../lib/host.js?没有标题服务=1')
    const 路由2 = new Map()
    const ctx2 = {
      agents: { get: () => undefined, list: () => [] },
      sessions: { flush: async () => true },
      webServer: { register: (r) => { 路由2.set(r.path, r.handler); return () => {} } },
      interval: () => () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      effect: (fn) => { fn() },
      on: () => () => {},
      // ⚠ 这里**没有 sessionTitle**（也没有 workspaceRegistry）
      get: (名) => (名 === 'sessions' ? 假ctx.get('sessions') : undefined),
    }
    插件2.apply(ctx2)

    const res = 造res()
    await 路由2.get('/dsh-speak-up/state')(
      {
        method: 'GET',
        url: '/dsh-speak-up/state',
        headers: {},
        [Symbol.asyncIterator]: async function* () { yield Buffer.from('{}') },
      },
      res,
    )
    assert.equal(res.体.ok, true, '没有标题服务也不能崩')
    const 清单 = res.体.活着的会话
    const 长 = 清单.find((x) => x.id === ID_带前缀)
    assert.equal(长.标题, '示例会话', '这条路不依赖任何服务')
    assert.equal(长.标题来源, '投影缓存 title')
    const 裸 = 清单.find((x) => x.id === ID_裸)
    assert.equal(裸.标题, '裸 id 那个会话')
  })

  await t.test('卸载：清理函数全跑一遍也不抛错', () => {
    assert.ok(清理们.length > 0)
    for (const 收 of 清理们) 收()
  })
})

// 收尾：把全局的随机数 / Date.now 还回去（同进程里别的文件不该被它影响）
after(() => {
  Math.random = 原随机
  Date.now = 真实now
})
