// 挑房间 —— 这一次要在哪间屋子里开口。
//
// 跟原来那版最大的差别：**不是等概率抓一个**。
//
// 原来的做法是 `可用[Math.floor(random * 可用.length)]` —— 每间屋子机会一样。
// 问题在于：一个人如果同时在三个地方跟它说话，等概率就意味着
// 「经常说话的那间」和「冷了一星期的那间」被翻牌的概率相同，
// 结果是它总在热闹的屋子里出声，冷屋子一直冷着。
//
// 现在按**沉寂程度加权**：
//   权重 = 基础 1
//        × 沉寂加成：1 + min(3, log2(1 + 沉寂分钟 / 30))   —— 每冷 30 分钟涨一档，最多 4 倍
//        × 近期折扣：上一次刚被抽中的屋子打 0.4 折（别连着两次同一间）
//   沉寂时间不明（读不到历史）时给 2 倍，落在"中等偏冷"的位置。
//
// 这不是概率公式的一部分（命中线才是），所以不会改变"多久开一次口"，
// 只改变"开在哪间屋子"。要恢复等概率：把下面的 `按权重抽` 换成 `等概率抽` 一行即可。

const 折扣倍数 = 0.4
const 沉寂档位分钟 = 30
const 沉寂最多翻几倍 = 4

/** 把沉寂分钟换算成一个加成倍数（1 ~ 4）。 */
export function 沉寂加成(分钟) {
  if (分钟 === undefined || 分钟 === null || !Number.isFinite(分钟)) return 2
  if (分钟 <= 0) return 1
  const 档 = Math.log2(1 + 分钟 / 沉寂档位分钟)
  return Math.min(沉寂最多翻几倍, 1 + Math.min(3, 档))
}

/**
 * 一间屋子能不能说话。
 * @returns {{ id, agent, 沉寂, 权重, 说明 } | { id, 原因 }}
 */
export function 看一间({ id, 找agent, 归档, 沉寂 }) {
  if (归档.has(String(id))) return { id, 原因: '已归档' }
  const agent = 找agent(id)
  if (agent === undefined) return { id, 原因: '没活着' }
  const 状态 = agent.status
  if (状态 !== undefined && 状态 !== 'idle') return { id, 原因: '忙' }
  return { id, agent, 沉寂, 权重: 沉寂加成(沉寂) }
}

/**
 * 从可用清单里抽一间。
 * @param 可用 [{ id, agent, 沉寂, 权重 }]
 * @param 上次抽中 { id, 时间 } | null
 * @param 现在 number（ms）
 * @param 随机 () => number（测试可以喂固定值）
 */
export function 抽一间({ 可用, 上次抽中, 现在 = Date.now(), 随机 = Math.random }) {
  if (可用.length === 0) return { 选中: null, 权重表: [] }
  const 权重表 = 可用.map((间) => {
    const 刚抽过 = 上次抽中 && String(上次抽中.id) === String(间.id)
      && 现在 - Number(上次抽中.时间 || 0) < 换手冷却毫秒
    return { ...间, 权重: 刚抽过 ? 间.权重 * 折扣倍数 : 间.权重, 刚抽过: Boolean(刚抽过) }
  })
  const 总 = 权重表.reduce((和, 间) => 和 + 间.权重, 0)
  if (!(总 > 0)) return { 选中: 权重表[Math.floor(随机() * 权重表.length)], 权重表 }
  let 点 = 随机() * 总
  for (const 间 of 权重表) {
    点 -= 间.权重
    if (点 <= 0) return { 选中: 间, 权重表 }
  }
  return { 选中: 权重表[权重表.length - 1], 权重表 }
}

/** 换手冷却：这么短时间内抽中过的屋子打折。 */
const 换手冷却毫秒 = 30 * 60 * 1000

/** 权重表渲染成一行的说明，给设置页看。 */
export function 说明权重(权重表) {
  return 权重表
    .map((间) => {
      const 沉寂 = 间.沉寂 === undefined ? '沉寂不明' : `${间.沉寂.toFixed(0)} 分钟没说话`
      return `${间.id}：${沉寂}，权重 ${间.权重.toFixed(2)}${间.刚抽过 ? '（刚抽过，打折）' : ''}`
    })
    .join('｜')
}
