const MENU_GGB = 'mtp-ai-geogebra'
const MENU_PROMPT = 'mtp-copy-prompt'
const MENU_LOG = 'mtp-open-log'

const AI_DEFAULTS = {
  baseUrl: 'https://api.qnaigc.com/v1',
  apiKey: 'sk-bbd3fe29eb0bca64cb1c00901e94b56e403f5adb698f6bf4cc0fe51811aeaba4',
  model: 'qiniu/conatus-free',
  fallbackModel: 'doubao-seed-2.0-mini',
  enabled: true,
  showLog: true,
  verboseLog: true,
  /** embed=左侧分栏，float=迷你浮窗 */
  windowMode: 'embed',
}

async function getCfg() {
  const stored = await chrome.storage.local.get('mtp_ai_cfg_v1')
  return { ...AI_DEFAULTS, ...(stored.mtp_ai_cfg_v1 || {}) }
}

async function setCfg(partial) {
  const next = { ...(await getCfg()), ...partial }
  await chrome.storage.local.set({ mtp_ai_cfg_v1: next })
  return next
}

function recreateMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_GGB,
      title: 'AI → GeoGebra（按默认窗口模式）',
      contexts: ['selection', 'image'],
    })
    chrome.contextMenus.create({
      id: 'mtp-ai-geogebra-embed',
      title: 'AI → GeoGebra（左侧分栏）',
      contexts: ['selection', 'image'],
    })
    chrome.contextMenus.create({
      id: 'mtp-ai-geogebra-float',
      title: 'AI → GeoGebra（迷你浮窗）',
      contexts: ['selection', 'image'],
    })
    chrome.contextMenus.create({
      id: MENU_PROMPT,
      title: '复制 AI 提示词（公式）',
      contexts: ['selection', 'image'],
    })
    chrome.contextMenus.create({
      id: MENU_LOG,
      title: '打开公式脚本日志',
      contexts: ['selection', 'page', 'image'],
    })
  })
}

chrome.runtime.onInstalled.addListener(async () => {
  recreateMenus()
  const cur = await chrome.storage.local.get('mtp_ai_cfg_v1')
  if (!cur.mtp_ai_cfg_v1) await chrome.storage.local.set({ mtp_ai_cfg_v1: AI_DEFAULTS })
})
chrome.runtime.onStartup.addListener(recreateMenus)

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(async () => {
    // 冷启动：先注入 content 再发
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return chrome.tabs.sendMessage(tabId, message)
  })
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return
  let action = null
  let forceMode = null
  if (info.menuItemId === MENU_GGB) action = 'geogebra'
  else if (info.menuItemId === 'mtp-ai-geogebra-embed') {
    action = 'geogebra'
    forceMode = 'embed'
  } else if (info.menuItemId === 'mtp-ai-geogebra-float') {
    action = 'geogebra'
    forceMode = 'float'
  } else if (info.menuItemId === MENU_PROMPT) action = 'prompt'
  else if (info.menuItemId === MENU_LOG) action = 'logs'
  if (!action) return
  try {
    await sendToTab(tab.id, {
      type: 'MTP_CONTEXT_ACTION',
      action,
      forceMode,
      selectionText: info.selectionText || '',
      srcUrl: info.srcUrl || '',
    })
  } catch (err) {
    console.warn('[mtp] context action failed', err)
  }
})

function isVectorCalcText(text) {
  const s = String(text || '')
  return /线积分|面积分|曲面积分|曲线积分|第一类|第二类|格林|高斯|斯托克斯|散度|旋度|通量|环流|对弧长|对坐标|半圆|圆周|圆弧|Green|Stokes|Divergence|flux|line\s*integral|surface\s*integral|∮|∫|∫|\\int\b|\iint|∯|\bds\b|\bdy\b|\bdx\b|P\s*dx\s*\+\s*Q\s*dy|\\mathrm\{d\}?\s*[sS]|\\mathbf\{[FGrn]\}|空间曲线|螺旋线|柱面|球面|半球|锥面|实体/i.test(
    s
  )
}

/** 题型分流：曲面/实体优先于螺旋线，避免整页题单被螺旋线模板劫持 */
function classifyScene(text, lines) {
  const s = String(text || '')
  const arr = Array.isArray(lines) ? lines : []
  const joined = arr.join('\n')
  const hasZIneq = /\bz\s*[<>]=?|\-\s*h\s*[<>]=?\s*z|z\s*[<>]=?\s*h|[−\-]\s*h\s*≤\s*z|z\s*≤\s*h/i.test(
    s + '\n' + joined
  )
  const hasXyzEq =
    /x\s*\^\s*2\s*\+\s*y\s*\^\s*2\s*\+\s*z\s*\^\s*2/i.test(s + joined) ||
    /x\^2\+y\^2\+z\^2/i.test((s + joined).replace(/\s+/g, ''))
  const hasCylEq =
    /x\s*\^\s*2\s*\+\s*y\s*\^\s*2\s*=/.test(s + joined) ||
    /x\^2\+y\^2=/.test((s + joined).replace(/\s+/g, ''))
  const has3dCurve = arr.some((l) => /\bCurve\s*\([^,]+,[^,]+,[^,]+,/i.test(l))
  const has3dPt = arr.some(
    (l) => /^\s*[A-Za-z]\w*\s*=\s*\([^,]+,[^,]+,[^,]+\)/.test(l) || /\bSurface\s*\(/i.test(l)
  )

  const isCyl = /柱面|圆柱/i.test(s) || (hasCylEq && (/z\s*=\s*0|z\s*=\s*2|截下|0\s*≤\s*z|平面\s*z/i.test(s) || hasZIneq))
  const isSphere = /上半球|半球面|球面/i.test(s) || hasXyzEq
  const isCone = /锥面|圆锥/i.test(s) || /z\s*=\s*sqrt\s*\(\s*x\^2/i.test(s)
  const isSolid =
    /空间实体|立体图形|实体|绕轴|拉伸|水平截面|双纽线/i.test(s) ||
    (hasZIneq && /实体|立体|截面|双纽线|不等式/.test(s))
  // 注意：不要用 /dS/i，会误伤对弧长 ds
  const isSurface = /曲面积分|对面积|∬|曲面\s*Σ|取上侧|取外侧|取下侧|(?:^|[^a-zA-Z])dS(?:[^a-zA-Z]|$)/.test(s)
  const isHelix =
    /螺旋线|空间曲线|x\s*=\s*cos\s*t[\s,]*y\s*=\s*sin\s*t[\s,]*z\s*=\s*t/i.test(s) ||
    (has3dCurve && /螺旋|空间曲线|z\s*=\s*t/i.test(s))
  // 纯平面线积分：有 ds 但无 z/曲面关键词
  const isPlaneLine =
    /对弧长|第一类曲线|线积分|圆周|上半圆|\bds\b/i.test(s) &&
    !/柱面|球面|半球|锥面|实体|空间曲线|螺旋|曲面积分|∬|三维/i.test(s) &&
    !hasZIneq &&
    !hasXyzEq

  // 优先级：柱/球/锥/实体 > 螺旋线；平面线积分绝不进 3D
  if (isPlaneLine) return { kind: 'plane', appName: 'graphing' }
  if (isCyl) return { kind: 'cylinder', appName: '3d' }
  if (isSphere) return { kind: 'sphere', appName: '3d' }
  if (isCone) return { kind: 'cone', appName: '3d' }
  if (isSolid) return { kind: 'solid', appName: '3d' }
  if (isSurface && (hasZIneq || hasXyzEq || hasCylEq || /柱|球|锥|Σ/.test(s))) {
    return { kind: 'surface', appName: '3d' }
  }
  if (isHelix || has3dCurve || has3dPt) return { kind: 'helix', appName: '3d' }
  if (/三维|3\s*D|立体图形/i.test(s) || hasZIneq) return { kind: 'solid', appName: '3d' }
  return { kind: 'plane', appName: 'graphing' }
}

function is3dText(text, lines) {
  return classifyScene(text, lines).appName === '3d'
}

function vectorCalcPromptExtra(kind) {
  const common = [
    '',
    '【线面积分演示模式 — 必遵】',
    '目标：画「可拖对象」，不要算数值，禁止 Integral()/答案文字。',
    '禁止只输出孤立滑块。',
  ]
  if (kind === 'helix') {
    return common
      .concat([
        '本题是空间曲线，用 GeoGebra 3D：',
        't=Slider(0,6.28,0.05)',
        'A=(cos(t),sin(t),t)',
        'Curve(cos(t),sin(t),t,t,0,6.28)',
      ])
      .join('\n')
  }
  if (kind === 'cylinder') {
    return common
      .concat([
        '本题是柱面曲面，用 GeoGebra 3D（禁止螺旋线 Curve）：',
        'r=Slider(1,3,0.1)',
        'h=Slider(0.5,4,0.1)',
        'x^2+y^2=r^2',
        'z=0',
        'z=h',
        '或：Surface(r*cos(u),r*sin(u),v,u,0,6.28,v,0,h)',
      ])
      .join('\n')
  }
  if (kind === 'sphere') {
    return common
      .concat([
        '本题是球面/半球，用 GeoGebra 3D（禁止螺旋线）：',
        'r=Slider(1,5,0.1)',
        'x^2+y^2+z^2=r^2',
        'z>=0',
      ])
      .join('\n')
  }
  if (kind === 'cone') {
    return common
      .concat([
        '本题是锥面，用 GeoGebra 3D：',
        'h=Slider(0.5,3,0.1)',
        'z=sqrt(x^2+y^2)',
        'z=h',
      ])
      .join('\n')
  }
  if (kind === 'solid' || kind === 'surface') {
    return common
      .concat([
        '本题是空间实体/曲面，用 GeoGebra 3D。有 z 范围必须输出 z 不等式，禁止螺旋线兜底。',
        '双纽线柱体示例：',
        'a=Slider(1,3,0.1)',
        'h=Slider(0.5,3,0.1)',
        '(x^2+y^2)^2<=2*a^2*(x^2-y^2)',
        'z>=-h',
        'z<=h',
        '柱面截段：x^2+y^2=1 与 z=0、z=h；球面：x^2+y^2+z^2=r^2。',
      ])
      .join('\n')
  }
  return [
    '',
    '【线面积分演示模式 — 必遵】',
    '目标：画「可拖路径 + 定向 +（可选）场/区域」，不要算数值，禁止 Integral()/答案文字。',
    '禁止只输出孤立滑块：路径曲线/参数点必须有。',
    '分层输出（有则写；每行一条）：',
    'L1 路径（必须）：参数点+滑块，或圆/半圆方程。半圆优先参数式。',
    'L2 定向：起点 S、终点 E（上半圆：S=(-a,0), E=(a,0)）。',
    'L3 对坐标线积分：再给 2～4 个 Vector 场样本；对弧长 ∫f ds 可省略场箭头。',
    'L4 闭曲线可加区域不等式作格林对照。',
    '',
    '对弧长示例（上半圆 x^2+y^2=a^2, y>=0，∫(x^2+y^2)ds）：',
    'a=Slider(1,5,0.1)',
    't=Slider(0,pi,0.05)',
    'A=(a*cos(t),a*sin(t))',
    'S=(-a,0)',
    'E=(a,0)',
    'x^2+y^2=a^2',
    '',
    '对坐标示例（单位圆，F=(-y,x)）：',
    't=Slider(0,6.28,0.05)',
    'A=(cos(t),sin(t))',
    'S=(1,0)',
    'P1=(1,0)',
    'Q1=(1,0.6)',
    'Vector(P1,Q1)',
    'x^2+y^2<=1',
  ].join('\n')
}

function hasUsable3dGeom(arr) {
  return arr.some(
    (l) =>
      /\bCurve\s*\(/i.test(l) ||
      /\bSurface\s*\(/i.test(l) ||
      /x\^2\s*\+\s*y\^2\s*\+\s*z\^2/i.test(l) ||
      /x\^2\s*\+\s*y\^2\s*=/i.test(l) ||
      /\bz\s*[<>=]/i.test(l) ||
      /^\s*[A-Za-z]\w*\s*=\s*\([^,]+,[^,]+,[^,]+\)/.test(l) ||
      /\(.*\^2.*\)\s*<=/.test(l)
  )
}

/** AI 若只吐出滑块，按题面补上常见路径/曲面模板（不再一律螺旋线） */
function ensureVectorCalcDemoLines(userText, lines) {
  const text = String(userText || '')
  const scene = classifyScene(text, lines)
  if (!isVectorCalcText(text) && scene.appName !== '3d') return lines
  let arr = Array.isArray(lines) ? lines.slice() : []
  arr = arr.map((l) => l.replace(/2\s*\*\s*pi/gi, '6.28').replace(/\b2pi\b/gi, '6.28').replace(/pi\/2/gi, '1.57'))

  if (scene.kind === 'helix') {
    if (!hasUsable3dGeom(arr) || !arr.some((l) => /\bCurve\s*\(/i.test(l))) {
      return [
        't=Slider(0,6.28,0.05)',
        'A=(cos(t),sin(t),t)',
        'Curve(cos(t),sin(t),t,t,0,6.28)',
      ]
    }
    if (!arr.some((l) => /^\s*[A-Za-z]\w*\s*=\s*\(/i.test(l))) {
      arr.push('A=(cos(t),sin(t),t)')
    }
    return arr
  }

  if (scene.kind === 'cylinder') {
    const hasCylGeom = arr.some((l) => /x\^2\s*\+\s*y\^2\s*=|\bSurface\s*\(/i.test(l))
    const pollutedByHelix = arr.some(
      (l) => /\bCurve\s*\(/i.test(l) || /=\(cos\(t\),\s*sin\(t\),\s*t\)/i.test(l)
    )
    if (!hasCylGeom || pollutedByHelix) {
      return ['r=Slider(1,3,0.1)', 'h=Slider(0.5,4,0.1)', 'x^2+y^2=r^2', 'z=0', 'z=h']
    }
    if (!arr.some((l) => /\bz\s*=/i.test(l))) {
      arr.push('z=0', 'z=2')
    }
    return arr.filter((l) => !/\bCurve\s*\(\s*cos/i.test(l))
  }

  if (scene.kind === 'sphere') {
    if (!arr.some((l) => /x\^2\s*\+\s*y\^2\s*\+\s*z\^2/i.test(l))) {
      return ['r=Slider(1,5,0.1)', 'x^2+y^2+z^2=r^2', 'z>=0']
    }
    if (/半球|z\s*≥\s*0|z\s*>=\s*0/i.test(text) && !arr.some((l) => /\bz\s*>=/i.test(l))) {
      arr.push('z>=0')
    }
    return arr.filter((l) => !/\bCurve\s*\(\s*cos/i.test(l))
  }

  if (scene.kind === 'cone') {
    if (!hasUsable3dGeom(arr)) {
      return ['h=Slider(0.5,3,0.1)', 'z=sqrt(x^2+y^2)', 'z=h']
    }
    return arr.filter((l) => !/\bCurve\s*\(\s*cos/i.test(l))
  }

  if (scene.kind === 'solid' || scene.kind === 'surface') {
    if (!hasUsable3dGeom(arr)) {
      if (/双纽线/i.test(text)) {
        return [
          'a=Slider(1,3,0.1)',
          'h=Slider(0.5,3,0.1)',
          '(x^2+y^2)^2<=2*a^2*(x^2-y^2)',
          'z>=-h',
          'z<=h',
        ]
      }
      if (/柱面/i.test(text)) {
        return ['r=Slider(1,3,0.1)', 'h=Slider(0.5,4,0.1)', 'x^2+y^2=r^2', 'z=0', 'z=h']
      }
      if (/球/i.test(text)) {
        return ['r=Slider(1,5,0.1)', 'x^2+y^2+z^2=r^2', 'z>=0']
      }
      return [
        'a=Slider(1,3,0.1)',
        'h=Slider(0.5,3,0.1)',
        '(x^2+y^2)^2<=2*a^2*(x^2-y^2)',
        'z>=-h',
        'z<=h',
      ]
    }
    // AI 已给截面不等式但缺 z：补拉伸高度
    if (
      arr.some((l) => /<=|>=/.test(l) && /x|y/.test(l)) &&
      !arr.some((l) => /\bz\s*[<>=]/i.test(l)) &&
      /实体|立体|拉伸|截面|−h|-\s*h/i.test(text)
    ) {
      if (!arr.some((l) => /h\s*=\s*Slider/i.test(l))) arr.unshift('h=Slider(0.5,3,0.1)')
      arr.push('z>=-h', 'z<=h')
    }
    return arr.filter((l) => !/\bCurve\s*\(\s*cos\(t\),\s*sin\(t\),\s*t/i.test(l))
  }

  const joined = arr.join('\n')
  const hasMovingPoint = arr.some(
    (l) => /^\s*[A-Z]\w*\s*=\s*\(.*cos\(.*sin\(/i.test(l) || /\(.*cos\(t\).*sin\(t\)/i.test(l)
  )
  const hasCurveEq = arr.some((l) => /x\^2\s*\+\s*y\^2\s*=/.test(l.replace(/\s+/g, '')))
  if ((hasMovingPoint || hasCurveEq) && arr.length >= 2) return arr

  // 上半圆 / 圆周 + ds / 线积分
  if (/半圆|圆周|圆弧|\bds\b|对弧长|线积分|∫/i.test(text) && /a|圆|x|y/i.test(text)) {
    return [
      'a=Slider(1,5,0.1)',
      't=Slider(0,pi,0.05)',
      'A=(a*cos(t),a*sin(t))',
      'S=(-a,0)',
      'E=(a,0)',
      'x^2+y^2=a^2',
    ]
  }
  if (!arr.length) return arr
  if (/a\s*=\s*Slider/i.test(joined) && !hasMovingPoint) {
    return [
      ...arr.filter((l) => /a\s*=\s*Slider/i.test(l)),
      't=Slider(0,pi,0.05)',
      'A=(a*cos(t),a*sin(t))',
      'S=(-a,0)',
      'E=(a,0)',
      'x^2+y^2=a^2',
    ]
  }
  return arr
}

function systemPrompt(userText) {
  // 完整速查见扩展目录 AI-GGB-API.md；此处为模型必遵的精简合同
  const scene = classifyScene(userText, [])
  const base = [
    scene.appName === '3d'
      ? '你输出 GeoGebra 3D 的 evalCommand 输入栏命令（英文命令名）。每行一条；不要 Markdown/编号/中文/JS。'
      : '你输出 GeoGebra Graphing 的 evalCommand 输入栏命令（英文命令名）。每行一条；不要 Markdown/编号/中文/JS。',
    '',
    '可用命令类型：',
    '- 函数：f(x)=e^x ； g(x)=e^a*(x-a)+e^a ； If(x!=0,(e^x-1)/x,1)',
    '- 点：A=(0,1) ； A=(a,e^a)；三维点 A=(cos(t),sin(t),t)',
    '- 滑块：a=Slider(-2,5,0.1)  （要拖的参数必须 Slider；禁止只写 a=0）',
    '- 不等式（多项式区域可填充）：x^2+y^2<=1 ； y>2*x+1；三维可加 z>=-h / z<=h',
    '- 复合条件必须拆成多行：禁止 &&；禁止 1<=f<=2 链式，改写为 f>=1 与 f<=2 两行',
    '- 分段函数用 If：f(x)=If(x<0,x^2,-x)',
    '- 复杂区域（含 sin/abs/exp）：同时给不等式 + 边界等式；abs 写成 (abs(x)^2)^(1/3)',
    '- 几何：Vector(O,A) ；Line(A,B)；圆/柱 x^2+y^2=1；球 x^2+y^2+z^2=r^2；Surface(...)',
    '',
    '硬规则：e^x/exp(x)；乘法写 *；(-1/e^a)*(x-a)；<= >= < > !=；不要 Exp/Point((x,y))/Limit/Solve/Integral/教程。',
    'Graphing 对非多项式不等式常画不出填充，边界等式必须给。极限题只输出函数。无内容输出 %none。',
    '若题面是柱面/球面/实体，禁止输出螺旋线 Curve(cos(t),sin(t),t,...)。',
    '',
    '切线滑块示例输出：',
    'f(x)=e^x',
    'a=Slider(-2,5,0.1)',
    'g(x)=e^a*(x-a)+e^a',
    'A=(a,e^a)',
  ]
  if (isVectorCalcText(userText) || scene.appName === '3d') {
    base.push(vectorCalcPromptExtra(scene.kind === 'plane' ? '' : scene.kind))
  }
  if (scene.appName === '3d') {
    base.push(
      '',
      `【三维模式·${scene.kind}】本题将用 GeoGebra 3D。按曲面/实体/空间曲线真实对象输出，不要把柱面/球面改成螺旋线。`
    )
  }
  return base.join('\n')
}

function normalizeAiCmd(line) {
  let s = String(line || '').trim()
  if (!s) return ''
  s = s.replace(/\bExp\s*\(/gi, 'exp(')
  s = s.replace(/\bPoint\s*\(\s*\(([^)]+)\)\s*\)/gi, '($1)')
  s = s.replace(/\bPoint\s*\(([^)]+)\)/gi, '($1)')
  s = s.replace(/(exp\([^)]+\))\s*\(/gi, '$1*(')
  s = s.replace(/(e\^[A-Za-z0-9]+)\s*\(/g, '$1*(')
  s = s.replace(/\)\s*\(/g, ')*(')
  s = s.replace(/(-?\d+(?:\.\d+)?)\s*\/\s*(e\^[A-Za-z0-9]+|exp\([^)]+\))\s*\(/gi, '($1/$2)*(')
  // 不等号统一成 GeoGebra 更稳的 ASCII
  s = s.replace(/≤|⩽|≦/g, '<=').replace(/≥|⩾|≧/g, '>=').replace(/≠|≂/g, '!=')
  s = s.replace(/\\le\b/gi, '<=').replace(/\\ge\b/gi, '>=').replace(/\\neq\b/gi, '!=')
  s = s.replace(/\\leq\b/gi, '<=').replace(/\\geq\b/gi, '>=')
  s = s.replace(/\\lt\b/gi, '<').replace(/\\gt\b/gi, '>')
  s = s.replace(/π/g, 'pi').replace(/𝜑|φ|ϕ/g, 'phi').replace(/arcsin/gi, 'asin')
  // 常见 2x → 2*x（仅在数字紧贴字母时）
  s = s.replace(/(\d)\s*([A-Za-z])/g, '$1*$2')
  return s.trim()
}

/** 验证：只保留 Graphing 大致可画的行（含不等式） */
function isPlottableGgbLine(line) {
  const s = String(line || '').trim()
  if (!s || s.startsWith('%')) return false
  if (/\bLimit\s*\(/i.test(s) || /(^|[^A-Za-z])lim\b/i.test(s)) return false
  if (/\b(Solve|NSolve|Integral|Derivative|Sum|Product|Expand|Factor)\s*\(/i.test(s)) return false
  // 纯中文说明
  if (/^[\u4e00-\u9fff\s，。、；：！？]+$/.test(s)) return false

  const hasIneq = /<=|>=|!=|<|>/.test(s)
  const hasAssign =
    /^(?:[A-Za-z]\w*\s*\([^)]*\)\s*=|[A-Za-z]\w*\s*=|y\s*=|x\s*=)/i.test(s) ||
    /^(?:\(|Vector\s*\(|Circle\s*\(|Line\s*\(|Segment\s*\(|If\s*\()/i.test(s)
  const hasBarePoint = /^\(\s*[-+\d.]+,\s*[-+\d.]+\s*\)$/.test(s)
  const hasEq = /=/.test(s)

  if (hasIneq) return true
  if (hasAssign || hasBarePoint) return true
  if (hasEq && /[A-Za-z0-9_)\])]$/.test(s.replace(/\s+$/, ''))) return true
  return false
}

function expandCompoundLine(line) {
  const s = String(line || '').trim()
  if (!s) return []
  const chain = s.match(
    /^\s*([-+0-9.]+|pi)\s*(<=|<|>=|>)\s*(.+?)\s*(<=|<|>=|>)\s*([-+0-9.]+|pi)\s*$/i
  )
  if (chain) {
    const [, a, op1, mid, op2, b] = chain
    const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }
    return [`${mid.trim()} ${flip[op1] || op1} ${a}`, `${mid.trim()} ${op2} ${b}`]
  }
  if (/\s*\|\|\s*/.test(s) || s.includes('||')) {
    // 并集：Graphing 无 ||，拆成多条分别画（叠在一起近似并）
    return s.split(/\s*\|\|\s*/).map((p) => p.trim()).filter(Boolean)
  }
  if (s.includes('&&')) return s.split(/&&/).map((p) => p.trim()).filter(Boolean)
  return [s]
}

function parseAiLines(content) {
  if (!content) return []
  let t = String(content).trim()
  t = t.replace(/^```(?:latex|tex|text|math)?\s*/i, '').replace(/\s*```$/i, '')
  const raw = t
    .split(/\r?\n/)
    .map((x) => x.replace(/^\s*\d+[\.)]\s*/, '').trim())
    .filter((x) => x && !x.startsWith('%') && !/^uncertain/i.test(x) && !/^none$/i.test(x))
  const out = []
  const seen = new Set()
  for (const line of raw) {
    for (const piece of expandCompoundLine(line)) {
      const n = normalizeAiCmd(piece)
      if (!isPlottableGgbLine(n)) continue
      const key = n.replace(/\s+/g, '').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(n)
    }
  }
  return out
}

async function chatOnce(cfg, model, messages) {
  const url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, temperature: 0, messages }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 返回空内容')
  return { content, model, data }
}

async function convertWithAI(userText, imageUrl) {
  const cfg = await getCfg()
  if (!cfg.enabled) throw new Error('AI 已关闭（请在扩展弹窗开启）')
  if (!cfg.apiKey) throw new Error('未配置 AI API Key')

  const parts = [userText || '']
  let userContent = parts.join('\n')
  const vectorCalc = isVectorCalcText(userContent)
  const messages = [{ role: 'system', content: systemPrompt(userContent) }]
  if (imageUrl && /^https?:/i.test(imageUrl)) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            userContent ||
            (vectorCalc
              ? '识别线/面积分题，按路径+定向+场样本+投影域输出 Graphing 命令'
              : '请识别图像中的公式并转成 GeoGebra 命令'),
        },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    })
  } else {
    messages.push({ role: 'user', content: userContent })
  }

  const models = [cfg.model, cfg.fallbackModel].filter(Boolean)
  let lastErr = null
  const tried = []
  for (const model of models) {
    if (tried.includes(model)) continue
    tried.push(model)
    try {
      const { content, model: used } = await chatOnce(cfg, model, messages)
      let lines = parseAiLines(content)
      let scene = classifyScene(userContent, lines)
      if (vectorCalc || scene.appName === '3d') {
        lines = ensureVectorCalcDemoLines(userContent, lines)
        scene = classifyScene(userContent, lines)
      }
      // 允许空：极限/结论等会被过滤掉，由页面提示「没有可画对象」
      return {
        lines,
        model: used,
        content,
        mode: scene.appName === '3d' ? '3d' : vectorCalc ? 'vector-calc' : 'default',
        appName: scene.appName,
        sceneKind: scene.kind,
      }
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('AI 转换失败')
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    if (msg?.type === 'MTP_GET_CFG') {
      sendResponse({ ok: true, cfg: await getCfg() })
      return
    }
    if (msg?.type === 'MTP_SET_CFG') {
      sendResponse({ ok: true, cfg: await setCfg(msg.partial || {}) })
      return
    }
    if (msg?.type === 'MTP_AI_CONVERT') {
      const r = await convertWithAI(msg.userText || '', msg.imageUrl || '')
      sendResponse({ ok: true, ...r })
      return
    }
    if (msg?.type === 'MTP_FETCH_GGB_DEPLOY') {
      const url = 'https://www.geogebra.org/apps/deployggb.js'
      const res = await fetch(url, { cache: 'force-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status} 拉取 deployggb.js`)
      const code = await res.text()
      if (!code || code.length < 100) throw new Error('deployggb.js 内容异常')
      sendResponse({ ok: true, code })
      return
    }
    if (msg?.type === 'MTP_OPEN_GGB_WINDOW') {
      const lines = Array.isArray(msg.lines) ? msg.lines : []
      const appName = msg.appName === '3d' ? '3d' : 'graphing'
      await chrome.storage.session.set({ mtpPendingLines: lines, mtpPendingAppName: appName })
      // loader（扩展页）读 storage，再 window.open 顶层沙箱 host，并 postMessage 下发命令
      await chrome.windows.create({
        url: chrome.runtime.getURL('ggb-loader.html') + '?v=1.4.9',
        type: 'popup',
        width: 480,
        height: 280,
        focused: true,
      })
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: 'unknown' })
  })().catch((err) => {
    sendResponse({ ok: false, error: err.message || String(err) })
  })
  return true
})
