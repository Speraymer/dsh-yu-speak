// DSH「主动说话」· 网页半边（设置页）
//
// 只干一件事：在「设置」左侧栏多出一页，把那十几格设置、两个手动试法和一份
// 最近记账摆出来，人改完就写回宿主。会话、发消息、掷骰子的判断都不在这儿 ——
// 在 lib/host.js，这样逻辑只有一份。
//
// 这边只认五条路由，字段名照宿主那边的叫法，一个都不另起：
//   GET  /dsh-speak-up/state             整份快照（配置 + 会话清单 + 记账）
//   GET  /dsh-speak-up/update?refresh=1  自查新版（不带 refresh 走宿主侧缓存）
//   POST /dsh-speak-up/save              补丁语义：只覆盖传上去的那几格
//   POST /dsh-speak-up/roll              { 模式: '演练' | '真发' }
//   POST /dsh-speak-up/new-session       { 设为目标: true }
//
// ⚠ 这是个**单文件**客户端包，别再拆成兄弟文件让这边 require：
//   外壳给的 require 是「模块表查名」（react 这类平台基线），没有相对路径解析器。
//   所以这里拆的是**函数**（见 ④），不是文件。
//
// ⚠ 槽位契约：settings.section 一个 id 一页侧栏。id 'speak-up' 和「主动说话」是
//   外面按它们找东西的名字，改了就找不到这一页。load 的 id 必须等于包名，
//   否则壳会当成「加载了却没注册」，DSH 卡在 Loading plugins。

window.__ModuleLoader__.load({
  id: 'dsh-yu-speak',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    // ⚠ 只用这三个 hook：平台基线里这就是全部可用面，多用一个就得多一份兼容风险。
    const { useState, useEffect, useCallback } = React

    // ---------- ① 跟宿主说话 ----------

    const 端点 = '/dsh-speak-up'

    /**
     * 读一次 JSON。断网、宿主没起、回来的不是 JSON —— 一律给 null，
     * 由调用处决定怎么把话说清楚。**不要在这里编一句「加载失败」**（那样分不清是谁的错）。
     */
    async function 取(路径) {
      try {
        const 应答 = await fetch(端点 + 路径, { cache: 'no-store' })
        return await 应答.json()
      } catch (错) {
        return null
      }
    }

    async function 送(路径, 体) {
      try {
        const 应答 = await fetch(端点 + 路径, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(体 || {}),
        })
        return await 应答.json()
      } catch (错) {
        return null
      }
    }

    const 宿主 = {
      读: () => 取('/state'),
      看更新: (强刷) => 取(强刷 ? '/update?refresh=1' : '/update'),
      存: (补丁) => 送('/save', 补丁),
      掷: (模式) => 送('/roll', { 模式 }),
      开会话: () => 送('/new-session', { 设为目标: true }),
    }

    /**
     * 把 /save、/new-session、/roll 回来的那份快照并进页面。
     *
     * ⚠ 是**并**不是替：宿主「存」是补丁语义，回来的可能是整份、也可能只带了动过的那几格；
     *   直接替换的话，页面里还没存下去的改动会被这次往返还悄悄抹掉。
     *   只认它真带了的字段，别把旧值改写成 undefined。
     */
    function 并入(旧, 新) {
      const 底 = 旧 && typeof 旧 === 'object' ? 旧 : {}
      if (!新 || typeof 新 !== 'object') return 底
      const 出 = { ...底 }
      if (新.配置 && typeof 新.配置 === 'object') 出.配置 = { ...(底.配置 || {}), ...新.配置 }
      for (const k of ['日志', '目标情况', '活着的会话']) {
        if (Array.isArray(新[k])) 出[k] = 新[k]
      }
      if (typeof 新.目标活着 === 'boolean') 出.目标活着 = 新.目标活着
      if (typeof 新.版本 === 'string') 出.版本 = 新.版本
      if (typeof 新.配置文件 === 'string') 出.配置文件 = 新.配置文件
      return 出
    }

    // ---------- ② 外观 ----------
    //
    // 颜色全走主题变量（--dsw-alias-*）：换皮肤、切深浅色都跟着变。
    // 只有两处例外：警示红（语义固定），和等宽字体（记账要能对齐着看）。

    const 描边 = 'var(--dsw-alias-border-l2)'
    const 描边淡 = 'var(--dsw-alias-border-l1, rgba(0,0,0,.08))'
    const 纸面 = 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))'
    const 悬停底 = 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04))'
    const 主色 = 'var(--dsw-alias-state-business-primary)'
    const 警示 = '#c0392b'
    const 等宽 = 'ui-monospace, Consolas, monospace'

    const 输入底 = {
      border: '1px solid ' + 描边,
      borderRadius: 6,
      padding: '4px 8px',
      background: 'transparent',
      color: 'inherit',
      fontSize: 12.5,
      boxSizing: 'border-box',
    }

    const 样 = {
      页: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 纸面,
        border: '1px solid ' + 描边淡,
        borderRadius: 12,
      },
      页头: { fontSize: 15, fontWeight: 600, margin: '2px 0 6px' },
      卡: {
        border: '1px solid ' + 描边,
        borderRadius: 10,
        padding: '12px 14px',
        marginTop: 12,
        background: 纸面,
      },
      卡头: { fontSize: 13.5, fontWeight: 600, margin: '0 0 6px' },
      小节: { fontSize: 12.5, fontWeight: 600, margin: '14px 0 6px', opacity: 0.85 },
      行: { display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 },
      标签: { flex: '0 0 190px', maxWidth: '100%', paddingTop: 3, fontSize: 12.5 },
      控件: { flex: '1 1 260px', minWidth: 210 },
      小字: { opacity: 0.62, fontSize: 11.5, marginTop: 2, lineHeight: 1.65 },
      红字: { color: 警示, fontSize: 12, fontWeight: 600, marginTop: 5, lineHeight: 1.6 },
      绿字: { color: 主色, fontSize: 12, marginTop: 6 },
      未存行: { fontSize: 12, color: 警示, fontWeight: 600, margin: '10px 0 2px' },
      已同步行: { fontSize: 12, color: 主色, margin: '10px 0 2px' },
      格: { ...输入底, width: '100%' },
      窄格: { ...输入底, width: 110 },
      长文: {
        ...输入底,
        width: '100%',
        padding: '8px 10px',
        lineHeight: 1.7,
        fontFamily: 'inherit',
        minHeight: 58,
      },
      按钮: {
        border: '1px solid ' + 描边,
        borderRadius: 6,
        padding: '5px 12px',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12.5,
      },
      按钮主: {
        border: '1px solid ' + 主色,
        borderRadius: 6,
        padding: '5px 12px',
        background: 主色,
        color: '#fff',
        cursor: 'pointer',
        fontSize: 12.5,
      },
      已勾框: {
        border: '1px solid ' + 描边,
        borderRadius: 6,
        padding: '6px 9px',
        fontSize: 12,
        lineHeight: 1.6,
      },
      清单: {
        border: '1px solid ' + 描边,
        borderRadius: 6,
        marginTop: 4,
        maxHeight: 260,
        overflowY: 'auto',
      },
      清单行: {
        display: 'flex',
        alignItems: 'center',
        padding: '5px 8px',
        cursor: 'pointer',
        borderBottom: '1px solid ' + 描边淡,
      },
      清单行勾: { background: 悬停底, fontWeight: 600 },
      手填区: {
        marginTop: 12,
        borderTop: '1px solid ' + 描边,
        paddingTop: 10,
      },
      代码块: {
        fontFamily: 等宽,
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(127,127,127,.1)',
        margin: '6px 0',
      },
      记账框: { marginTop: 8, maxHeight: 260, overflowY: 'auto' },
      记账行: { fontFamily: 等宽, fontSize: 11.5, whiteSpace: 'pre-wrap' },
      /**
       * 悬浮的保存条：只在「有改动还没存」时渲染。
       * ⚠ sticky 而不是 fixed —— 它属于这一页，滚到哪都贴在**这一页**底部，
       *   不会跑到别的设置页上；不脏的时候干脆不渲染，平时不占地方。
       */
      浮条: {
        position: 'sticky',
        bottom: 0,
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid ' + 描边,
        background: 纸面,
        boxShadow: '0 -6px 18px rgba(0,0,0,.18)',
        zIndex: 5,
      },
    }

    // ---------- ③ 小零件 ----------
    //
    // 一律是**普通函数直接调用**（不是 h(组件, …)）：这个包在壳里按 classic script
    // 跑，没有编译期 JSX；把它们写成函数调用，渲染树里就只剩真元素，
    // 冒烟测试拿假 React 也能把整棵树走一遍。

    const 小字 = (文字) => (文字 ? h('div', { style: 样.小字 }, 文字) : null)
    const 红字 = (文字) => h('div', { style: 样.红字 }, 文字)
    const 隔 = () => h('span', { style: { display: 'inline-block', width: 8 } })

    /** 一行设置：左边标签、右边控件、控件下面一句人话。 */
    const 行项 = (标签, 控件, 说明) =>
      h(
        'div',
        { style: 样.行 },
        h('div', { style: 样.标签 }, 标签),
        h('div', { style: 样.控件 }, 控件, 说明 ? 小字(说明) : null),
      )

    /** 一张卡。内容可以是数组（createElement 会摊平）。 */
    const 卡 = (标题, 内容, 副注) =>
      h(
        'div',
        { style: 样.卡 },
        h('div', { style: 样.卡头 }, 标题),
        副注 ? 小字(副注) : null,
        内容,
      )

    const 按钮 = (文字, 点, 主, 禁用) =>
      h(
        'button',
        {
          type: 'button',
          style: 主 ? 样.按钮主 : 样.按钮,
          onClick: 点,
          disabled: !!禁用,
          title: 文字,
        },
        文字,
      )

    const 复选 = (值, 改) =>
      h('input', { type: 'checkbox', checked: !!值, onChange: (e) => 改(e.target.checked) })

    const 数字 = (值, 改, 步) =>
      h('input', {
        type: 'number',
        style: 样.窄格,
        step: 步 || 1,
        value: 值 === undefined || 值 === null ? '' : 值,
        onChange: (e) => 改(e.target.value),
      })

    const 单行 = (值, 改, 占位) =>
      h('input', {
        type: 'text',
        style: 样.格,
        value: 值 === undefined || 值 === null ? '' : 值,
        placeholder: 占位,
        onChange: (e) => 改(e.target.value),
      })

    const 多行 = (值, 改) =>
      h('textarea', {
        style: 样.长文,
        value: 值 === undefined || 值 === null ? '' : String(值),
        onChange: (e) => 改(e.target.value),
      })

    /** id 的尾巴：开头的 session- 和 uuid 前缀全长一样，只有后 8 位分得清谁是谁。 */
    const 尾号 = (id) => {
      const s = String(id === undefined || id === null ? '' : id)
      return s.length <= 8 ? s : s.slice(-8)
    }

    /** 标题拿不到就明说，**绝不留白** —— 留白看着像页面坏了。 */
    const 名字 = (会话) => {
      const 题 = 会话 && 会话.标题
      return typeof 题 === 'string' && 题.trim() !== '' ? 题.trim() : '（未命名会话）'
    }

    /** 逗号、顿号、分号、空格都当分隔符：从别处粘一串 id 过来基本都能吃。 */
    const 拆id = (文) =>
      String(文 === undefined || 文 === null ? '' : 文)
        .split(/[\s,;，、]+/)
        .filter((x) => x !== '')

    /** 剪贴板不一定给（老壳、非 https），所以每一步都得有话说。 */
    function 复制(文, 回报) {
      try {
        const 板 = typeof window !== 'undefined' && window.navigator && window.navigator.clipboard
        if (!板) {
          回报('这个窗口不给剪贴板，手动选中吧')
          return
        }
        板
          .writeText(文)
          .then(() => 回报('命令拷好了'))
          .catch(() => 回报('拷不动，手动选中吧'))
      } catch (错) {
        回报('拷不动，手动选中吧')
      }
    }

    // ---------- ④ 各个块 ----------
    //
    // 每个块都是「拿一包值 → 吐一棵元素树」的纯函数，自己没有状态。
    // 状态全在下面的设置页里，这样一页几个块的状态不用互相找。

    /**
     * 安装 / 更新命令。仓库名从宿主查回来的 repoUrl 里摘 ——
     * 换仓库、改 fork 都不用回来动这里。
     */
    function 装命令(更新) {
      const 址 = String((更新 && 更新.repoUrl) || '')
      const 摘 = /github\.com[/:]([^/\s]+)\/([^/#?\s]+)/i.exec(址)
      const 仓库 = 摘 ? 'github:' + 摘[1] + '/' + 摘[2].replace(/\.git$/i, '') : 'github:Speraymer/dsh-yu-speak'
      return 'dsh plugin --profile desktop add ' + 仓库
    }

    function 更新块(更新, 查着, 去查, 回报) {
      const 状况 = !更新
        ? '还没问过。'
        : 更新.hasUpdate
          ? '仓库那边已经到 v' + String(更新.latest) + ' 了（本机 v' + String(更新.current || '?') + '）。'
          : 更新.ok
            ? '已经是最新（v' + String(更新.current || 更新.latest || '?') + '）' +
              (更新.ahead ? ' —— 本机其实还新一点，自己改的还没推？' : '')
            : '没问出来：' + String(更新.error || '网络') + '。查不到不等于没事，别当成「已是最新」。'

      const 内容 = [小字(状况), h('div', { style: { marginTop: 8 } }, 按钮(查着 ? '问着呢…' : '去问一下', 去查, false, 查着))]

      if (更新 && 更新.hasUpdate) {
        内容.push(
          h(
            'div',
            { style: { marginTop: 10 } },
            小字('换新版走装插件那条路：先卸，再装。直接覆盖装很可能装到缓存里的旧副本。'),
            h('div', { style: 样.代码块 }, 装命令(更新)),
            按钮('拷走这条命令', () => 复制(装命令(更新), 回报), false, false),
          ),
        )
      }

      return 卡('插件版本', 内容)
    }

    function 闸门块(值, 改) {
      return 卡('先决定开不开口', [
        行项(
          '总开关',
          复选(值.总开关, (v) => 改('总开关', v)),
          '关掉就彻底不动。定时器还在那儿挂着，但每一轮进来都直接返回。',
        ),
        行项(
          '试运行（出厂就是开的）',
          复选(值.试运行, (v) => 改('试运行', v)),
          '开着的时候，掷中也只写一条账、不发出去。先攒几轮账看看时机对不对，觉得可以了再关它。',
        ),
      ])
    }

    function 节奏块(值, 改) {
      return 卡('多久掷一次', [
        行项(
          '间隔分钟',
          数字(值.间隔分钟, (v) => 改('间隔分钟', v)),
          '默认 30，范围 1～1440。存完这一轮就按新数字排，不用重启。',
        ),
        行项(
          '搭话冷却分钟',
          数字(值.搭话冷却分钟, (v) => 改('搭话冷却分钟', v)),
          '她刚自己开过口，这么多分钟内就不再开口（默认 20）。填 0 就是不冷却。' +
            '「演练一次 / 真发一次」这两个按钮不受它管。',
        ),
      ])
    }

    /**
     * 一次掷骰怎么算 —— 原来散在三张卡里的东西并到一张：
     * 基础线、时机因子、攒加成本来就是同一个算式里的三段，拆开看反而要来回翻。
     *
     * ⚠ 时机因子那两档（近/远阈值 + 两个因子）和加成上限现在是**写死的常量**
     *   （lib/host.js 顶上的 `写死`），设置页上没有这 5 个控件 —— 这里只留一句说明。
     *   别再把它们变回输入框：宿主归一化会把值覆盖掉，填了也不生效。
     */
    function 算式块(值, 改) {
      return 卡(
        '这一掷怎么算',
        [
          小字('每轮在 0～100 里取一个数，落在命中线下面才开口；落在上面就不开。'),
          h('div', { style: 样.小节 }, '① 基础命中线 —— 贵的时候压低，便宜的时候抬高'),
          行项(
            '峰时命中线（%）',
            数字(值.峰时命中线, (v) => 改('峰时命中线', v)),
            '默认 20：贵的时候少开口。峰时是写死的，不用你填 —— 周一~周五 9:00~12:00、14:00~18:00。',
          ),
          行项(
            '谷时命中线（%）',
            数字(值.谷时命中线, (v) => 改('谷时命中线', v)),
            '默认 60：便宜的时候多开口。其余全算谷时 —— 午休 12:00~14:00、18:00 到次日 9:00、周六周日整天。',
          ),
          红字('⚠ 两个数填成一样 = 不分峰谷，全天就一条线'),
          红字(
            '⚠ 安静时段压得住谷时：现在是 ' +
              String(值.安静起) +
              '~' +
              String(值.安静止) +
              ' 点，那段时间压根不掷，谷时线抬得再高也轮不上',
          ),
          小字(
            '时机因子不能改（代码里写死）：距她上次说话 20 分钟以内 → 线 × 0.15；' +
              '超过 360 分钟（6 小时）→ 线 × 1.5；两边都不沾的那一段 → 线 × 1，不加不减。',
          ),
          h('div', { style: 样.小节 }, '② 连着没中就攒加成 —— 一次比一次容易'),
          行项(
            '没中加成（百分点）',
            数字(值.没中加成, (v) => 改('没中加成', v)),
            '每没掷中一次，下一轮的线加这么多（默认 10）。填 0 就是不要这套攒加成，一分都不加。',
          ),
          小字('掷中一次（试运行里掷中算）就清零，从 0 重新攒；一直没中就一次次加上去，顶到 40 为止（上限也是写死的）。'),
          小字('这一格只管自动的定时掷骰。「演练一次 / 真发一次」不掷骰，也不动这个计数。'),
          小字('⚠ 「连着没中」这个数只记在内存里：DSH 一重启就归零。'),
          小字('总账：线 = 基础线（看是峰时还是谷时）× 时机因子 + 攒下来的加成，算完夹在 0～100。'),
        ],
      )
    }

    function 安静块(值, 改) {
      return 卡('安静时段', [
        h(
          'div',
          { style: 样.行 },
          h('div', { style: 样.标签 }, '安静起 / 安静止（小时）'),
          h(
            'div',
            { style: 样.控件 },
            h(
              'div',
              null,
              数字(值.安静起, (v) => 改('安静起', v)),
              h('span', { style: 样.小字 }, ' 点到 '),
              数字(值.安静止, (v) => 改('安静止', v)),
              h('span', { style: 样.小字 }, ' 点'),
            ),
            小字('默认 1 点到 8 点不掷（含 1 点、不含 8 点）。跨午夜也行，比如 23 到 7。'),
          ),
        ),
        红字('⚠ 两个数填成一样 = 安静时段等于没开，整天都可能掷'),
      ])
    }

    function 目标块(参数) {
      const { 态, 目标们, 切, 手填, 设手填, 存, 刷新, 新建, 忙 } = 参数
      const 情况 = Array.isArray(态.目标情况) ? 态.目标情况 : []
      const 会话们 = Array.isArray(态.活着的会话) ? 态.活着的会话 : []
      const 活着数 = 情况.filter((x) => x && x.活着).length
      const 勾着 = (id) => 目标们.indexOf(id) >= 0
      const 手填文本 = 手填 === null ? 目标们.join(', ') : 手填

      // 清单里的一行：☐ 标题 · …后8位 · 状态。整行都能点（label 包着），点了立刻存。
      const 清单行 = (会话) =>
        h(
          'label',
          {
            key: String(会话.id),
            style: { ...样.清单行, ...(勾着(会话.id) ? 样.清单行勾 : null) },
            title:
              String(会话.id) +
              (会话.标题来源 ? '｜标题来自：' + String(会话.标题来源) : '') +
              (会话.有agent ? '' : '（这间现在没开，掷中了会跳过去）') +
              (会话.归档 ? '（⚠ 已经归档了，建议取消勾选）' : ''),
          },
          h('input', {
            type: 'checkbox',
            checked: 勾着(会话.id),
            onChange: (e) => 切(会话.id, e.target.checked),
          }),
          h(
            'span',
            { style: { marginLeft: 8, ...(会话.有agent ? null : { opacity: 0.62 }) } },
            名字(会话),
          ),
          h(
            'span',
            { style: { ...样.小字, marginLeft: 8, whiteSpace: 'nowrap' } },
            '…' + 尾号(会话.id) + ' · ' + String(会话.状态 || '?'),
          ),
          会话.归档 ? h('span', { style: { ...样.小字, marginLeft: 6, color: 警示 } }, '⚠ 已归档') : null,
        )

      const 摘要 =
        目标们.length === 0
          ? 红字('一个都没勾 —— 掷中了也没地方开口')
          : h(
              'div',
              { style: 样.已勾框 },
              h(
                'div',
                null,
                '已勾 ' +
                  目标们.length +
                  ' 个' +
                  (情况.length
                    ? '：' +
                      情况
                        .map(
                          (x) =>
                            (x && x.标题 ? x.标题 : '…' + 尾号(x && x.id)) +
                            (x && x.活着 ? '' : '（没活着）'),
                        )
                        .join('、')
                    : ''),
              ),
              情况.length === 0
                ? 小字('（宿主还没报这几间的情况）')
                : 小字(
                    活着数 === 0
                      ? '一间都没活着 —— 这一掷会跳过去，先把会话开起来'
                      : '其中 ' + 活着数 + ' 间现在活着',
                  ),
            )

      const 清单块 =
        会话们.length === 0
          ? h(
              'div',
              { style: { ...样.小字, marginTop: 8 } },
              '宿主那边现在没有开着的会话（在 DSH 里开一间，再回来按「重读清单」）。',
            )
          : h(
              'div',
              { style: { marginTop: 8 } },
              h('div', { style: 样.小字 }, '现在开着的会话（点一下 = 勾上 / 取消，当场就存）：'),
              h('div', { style: 样.清单 }, 会话们.map(清单行)),
              h(
                'div',
                { style: { ...样.小字, marginTop: 4 } },
                '已归档的不列出来（掷中也会被 DSH 拦下）；只有你已经勾着的那几间还会露出来，' +
                  '标着「⚠ 已归档」—— 看到就取消。' +
                  '没名字的显示「（未命名会话）」加一串号尾巴，照样能勾。' +
                  '标「没活着」的是现在没打开的会话，勾了这一轮也会跳过去。',
              ),
            )

      return 卡('目标会话', [
        h(
          'div',
          { style: 样.小字 },
          '她只在这些会话里开口。勾几间都行；一次掷中只挑其中一间（活着、又不忙的那间）。',
        ),
        h('div', { style: { ...样.小字, marginTop: 2, fontWeight: 600 } }, '✓ 勾和取消都是一点就存，不用再按保存'),
        h('div', { style: { marginTop: 6 } }, 摘要),
        清单块,
        h(
          'div',
          { style: { marginTop: 10 } },
          按钮('重读清单', 刷新, false, 忙),
          隔(),
          按钮('新开一间并勾上', 新建, false, 忙),
        ),
        h(
          'div',
          { style: 样.手填区 },
          h('div', { style: 样.小字 }, '也可以直接把会话 id 粘进来（逗号、顿号、分号、空格都认）—— 手填的要按保存才算数：'),
          h('div', { style: { marginTop: 4 } }, 单行(手填文本, 设手填, 'session-xxxxxxxx-…, session-yyyyyyyy-…')),
          h('div', { style: { marginTop: 6 } }, 按钮('存下这几个 id', 存, true, 忙)),
        ),
      ])
    }

    /**
     * 送出去的那句话。
     * ⚠ 这里原来还有一个「角色」下拉（user / developer）：已经拿掉了 ——
     *   角色写死成 user（DSH 只放行这一个，见 lib/host.js 文件头），
     *   宿主归一化会强制覆盖，页面上留个下拉只会骗人。
     */
    function 台词块(值, 改) {
      return 卡('送出去的那句话', [
        行项(
          '触发文案',
          多行(值.触发文案, (v) => 改('触发文案', v)),
          '用她自己的口气写。这是递进去的一句台词，不是系统提示。',
        ),
      ])
    }

    function 动作块(参数) {
      const { 忙, 存, 演练, 真发, 刷新, 回话 } = 参数
      return 卡('自己动手试', [
        h(
          'div',
          null,
          按钮('保存设置', 存, true, 忙),
          隔(),
          按钮('演练一次（绝不发出去）', 演练, false, 忙),
          隔(),
          按钮('真发一次（不等排程）', 真发, false, 忙),
          隔(),
          按钮('重读一遍', 刷新, false, 忙),
        ),
        小字('数字、文案、开关改完 → 按「保存设置」。「目标会话」的勾不用按，勾一下就已经存了。'),
        小字(
          '「演练一次」把整套判断走到底 —— 安静时段、骰子、因子全过一遍 —— 但一个字都不发，' +
            '只告诉你本来要说什么。「真发一次」当场真送一轮，用来验路通不通。',
        ),
        回话 ? h('div', { style: 样.绿字 }, 回话) : null,
      ])
    }

    function 记账块(日志) {
      return 卡('最近 ' + 日志.length + ' 条记账（新的在最下面）', [
        小字('每一轮都留一条，没掷中也留 —— 这样才看得出它真在跑。'),
        h(
          'div',
          { style: 样.记账框 },
          日志.length === 0
            ? 小字('还没有记账。')
            : 日志.map((条, i) =>
                h(
                  'div',
                  { key: i, style: 样.记账行 },
                  String((条 && 条.时间) || '') + '　' + String((条 && 条.文本) || ''),
                ),
              ),
        ),
      ])
    }

    // ---------- ⑤ 设置页 ----------

    function 设置页() {
      // ① 宿主那份快照；null = 还没读到
      const [态, 设态] = useState(null)
      // ② 只装「改过、还没存」的那几格 —— 脏不脏是这个对象的键数，不是一个单独的布尔
      const [草稿, 设草稿] = useState({})
      // ③ 上一次动作的回话（保存 / 演练 / 真发 / 新建都落在这一句里）
      const [回话, 设回话] = useState('')
      // ④ 有请求在路上：按钮一起变灰，防连点
      const [忙, 设忙] = useState(false)
      // ⑤ 手填 id 的草稿；null = 没碰过，显示配置里那一份
      const [手填, 设手填] = useState(null)
      // ⑥ 勾选自动保存的回话（跟 ③ 分开：一个说「刚落到盘上了」，
      //    一个说「这一掷干了什么」，两者不该抢同一行）
      const [落盘, 设落盘] = useState('')
      // ⑦⑧ 自查新版
      const [更新, 设更新] = useState(null)
      const [查着, 设查着] = useState(false)

      const 拉 = useCallback(async () => {
        const r = await 宿主.读()
        if (r && r.ok) {
          设态((旧) => 并入(旧, r))
          设回话('')
        } else {
          设回话('读不到宿主那边的状态 —— 插件加载了吗？')
        }
      }, [])

      useEffect(() => {
        拉()
      }, [拉])

      useEffect(() => {
        宿主.看更新(false).then((r) => {
          if (r) 设更新(r)
        })
      }, [])

      // 还是空白的时候只说一句「在等」，别摆一张空表 —— 空表看着像都清零了
      if (!态 || !态.配置) {
        return h(
          'div',
          { style: 样.页 },
          h('div', { style: 样.页头 }, '主动说话'),
          h('div', { style: 样.小字 }, 回话 || '正在跟宿主要状态…'),
        )
      }

      const 配置 = 态.配置
      /**
       * 现值 = 宿主那份 + 草稿盖上去。各块读的都是这一份，
       * 所以改一格当场看得见，而宿主那份始终还是「上次存下去的」，脏不脏一目了然。
       */
      const 现值 = { ...配置, ...草稿 }
      const 改 = (k, v) => 设草稿((旧) => ({ ...旧, [k]: v }))
      const 脏 = Object.keys(草稿).length > 0
      const 目标们 = Array.isArray(现值.目标会话) ? 现值.目标会话 : []
      const 日志 = Array.isArray(态.日志) ? 态.日志 : []

      /**
       * 勾一下 = 立刻落盘。
       *
       * ⚠ 这是踩过坑改的：最早那版是「勾进输入框 → 再按下面的保存」，结果人勾了没按，
       *   宿主一直报「还没配目标会话」，页面上又没有半句「你还没存」的提示。
       *   勾选这类核心设置就该点一下就落盘，不该等人记得按按钮。
       * ⚠ 只发「目标会话」这一个补丁：宿主是合并语义，别顺手把她别的没存改动一起提交了。
       */
      const 自动存 = async (下一个) => {
        设落盘('正在存…')
        const r = await 宿主.存({ 目标会话: 下一个 })
        if (r && r.ok) {
          设态((旧) => 并入(旧, r))
          // 刚存下去的这一格从草稿里撤掉；别的没存的改动原样留着
          设草稿((旧) => {
            const 余 = { ...旧 }
            delete 余.目标会话
            return 余
          })
          设落盘('已保存 ✓')
        } else {
          设落盘('存不进去 ✗')
        }
      }

      const 切 = (id, 勾上) => {
        const 下一个 = 勾上 ? [...目标们.filter((x) => x !== id), id] : 目标们.filter((x) => x !== id)
        设草稿((旧) => ({ ...旧, 目标会话: 下一个 }))
        自动存(下一个)
      }

      const 存 = async () => {
        设忙(true)
        // 手填框里还有没提交的草稿 → 存的时候一起带上（其余字段以「配置 + 草稿」为准）
        const 要发 = { ...配置, ...草稿 }
        if (手填 !== null) 要发.目标会话 = 拆id(手填)
        const r = await 宿主.存(要发)
        if (r && r.ok) {
          设态((旧) => 并入(旧, r))
          设草稿({})
          设手填(null)
          设落盘('已保存 ✓')
          设回话(r.说 || '存好了')
        } else {
          设回话((r && r.说) || '没存进去')
          设落盘('存不进去 ✗')
        }
        设忙(false)
      }

      const 掷 = async (模式) => {
        设忙(true)
        const r = await 宿主.掷(模式)
        if (r && r.ok) 设态((旧) => 并入(旧, { 日志: r.日志 }))
        设回话((r && r.说) || '跑完了，看下面的记账')
        设忙(false)
      }

      const 新建 = async () => {
        const 答应 =
          typeof window === 'undefined' || typeof window.confirm !== 'function'
            ? true
            : window.confirm('开一间空的会话，顺手勾上它？（你的会话列表里会多一条）')
        if (!答应) return
        设忙(true)
        const r = await 宿主.开会话()
        if (r && (r.ok || r.新会话)) {
          设态((旧) => 并入(旧, r))
          设草稿((旧) => {
            const 余 = { ...旧 }
            delete 余.目标会话
            return 余
          })
          设手填(null)
        }
        设回话((r && r.说) || '做完了')
        设忙(false)
      }

      const 去查 = async () => {
        设查着(true)
        const r = await 宿主.看更新(true)
        if (r) 设更新(r)
        设查着(false)
      }

      const 出事 = 落盘 === '存不进去 ✗'
      const 状态文 = 出事
        ? '⚠ 上一次没存进去 —— 网络断了，还是宿主不在了？'
        : 脏
          ? '⚠ 上面有改动还没保存 —— 数字和文案改完要按「保存设置」'
          : '设置已同步 ✓' + (落盘 === '正在存…' ? '（正在存…）' : '')

      return h(
        'div',
        { style: 样.页 },

        h('div', { style: 样.页头 }, '主动说话'),
        h(
          'div',
          { style: 样.小字 },
          '没人搭话的时候，她自己也会挑个时机开口。骰子在本地掷，没掷中一分钱不花；' +
            '掷中了才往你勾的会话里递一句话，让 DSH 自己走一轮 —— 人格、历史、工具、记忆都是她自己的。',
        ),
        h(
          'div',
          { style: { ...样.小字, marginTop: 4 } },
          '版本 ' + String(态.版本 || '?') + ' · 设置写在 ' + String(态.配置文件 || '（宿主没说）'),
        ),

        h('div', { style: 出事 || 脏 ? 样.未存行 : 样.已同步行 }, 状态文),
        h('div', { style: 样.小字 }, '（勾选会话不用按保存，勾一下当场就存）'),

        更新块(更新, 查着, 去查, 设回话),

        闸门块(现值, 改),
        节奏块(现值, 改),
        算式块(现值, 改),
        安静块(现值, 改),

        目标块({
          态,
          目标们,
          切,
          手填,
          设手填,
          存,
          刷新: 拉,
          新建,
          忙,
        }),

        台词块(现值, 改),
        动作块({ 忙, 存, 演练: () => 掷('演练'), 真发: () => 掷('真发'), 刷新: 拉, 回话 }),
        记账块(日志),

        h(
          'div',
          { style: { ...样.小字, marginTop: 12 } },
          '⚠ 掷骰是本地随机，不花模型；只有掷中之后真发，才真的会走一轮、真的会花 token。',
        ),

        // 悬浮的保存条：**只要还有没存的改动就贴在底下冒出来**。
        // 人原话是「改了还得滚到底下去按一下，谁记得」。不脏就压根不渲染，不挡视线。
        脏
          ? h(
              'div',
              { style: 样.浮条 },
              h('span', { style: { fontWeight: 600, color: 警示 } }, '⚠ 有改动还没保存'),
              h('span', { style: 样.小字 }, '数字、文案、开关改完，点这个存下去就行'),
              按钮('保存设置', 存, true, 忙),
            )
          : null,
      )
    }

    // ---------- ⑥ 接线 ----------

    /** 只依赖 slots —— 缺它就别加载（声明在 exports.inject 里，壳会等它就位）。 */
    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          // id / label / order 是这一页在外面的身份：设置页侧栏按 id 找页、按 label 显示。
          { name: 'settings.section', id: 'speak-up', order: 53, label: () => '主动说话' },
          设置页,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
