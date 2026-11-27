/**
 * 题型分流 + ensure 模板单测（不依赖 Chrome）
 * 运行：node test-scene-classify.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import vm from 'vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8')

// 抽出纯函数段（到 normalizeAiCmd 之前）
const start = src.indexOf('function isVectorCalcText')
const end = src.indexOf('function normalizeAiCmd')
if (start < 0 || end < 0) throw new Error('cannot slice background.js helpers')
const code = src.slice(start, end) + '\n;({ classifyScene, ensureVectorCalcDemoLines, is3dText })'
const api = vm.runInNewContext(code, Object.create(null), { timeout: 2000 })

let failed = 0
function assert(name, cond, detail) {
  if (cond) console.log('  OK ', name)
  else {
    failed++
    console.log('  FAIL', name, detail || '')
  }
}

console.log('=== classifyScene ===')
const cases = [
  {
    name: '柱面题10',
    text: '题10（柱面参数化）Σ 为柱面 x^2+y^2=1 被平面 z=0, z=2 截下的部分，求 ∬(x^2+y^2+z)dS',
    expect: { kind: 'cylinder', appName: '3d' },
  },
  {
    name: '半球题14',
    text: '题14 Σ 为上半球面 x^2+y^2+z^2=R^2 (z≥0)，取上侧，求曲面积分',
    expect: { kind: 'sphere', appName: '3d' },
  },
  {
    name: '双纽线实体',
    text: '双纽线绕轴形成的空间实体 (x^2+y^2)^2≤2a^2(x^2−y^2),−h≤z≤h 水平截面是双纽线',
    expect: { kind: 'solid', appName: '3d' },
  },
  {
    name: '螺旋线',
    text: 'L 为螺旋线 x=cost, y=sint, z=t，t∈[0,2π]，求 ∫ z ds',
    expect: { kind: 'helix', appName: '3d' },
  },
  {
    name: '上半圆对弧长(2D)',
    text: 'L 为圆周 x^2+y^2=a^2 的上半圆（y≥0），求 ∫(x^2+y^2)ds',
    expect: { kind: 'plane', appName: 'graphing' },
  },
  {
    name: '格林单位圆(2D)',
    text: 'L 为圆周 x^2+y^2=1，取逆时针，求 ∮(x+y)dx−(x−y)dy',
    expect: { kind: 'plane', appName: 'graphing' },
  },
  {
    name: 'AI已给出双纽线命令',
    text: '双纽线空间实体',
    lines: [
      'a=Slider(0,5,0.1)',
      'h=Slider(0,5,0.1)',
      '(x^2 + y^2)^2 <= 2*a^2*(x^2 - y^2)',
      'z >= -h',
      'z <= h',
    ],
    expect: { kind: 'solid', appName: '3d' },
  },
]

for (const c of cases) {
  const got = api.classifyScene(c.text, c.lines || [])
  assert(
    c.name,
    got.kind === c.expect.kind && got.appName === c.expect.appName,
    `got ${JSON.stringify(got)} expect ${JSON.stringify(c.expect)}`
  )
}

console.log('=== ensureVectorCalcDemoLines ===')
{
  const text = '题10 柱面 x^2+y^2=1 被 z=0,z=2 截下'
  const badAi = ['t=Slider(0,6.28,0.05)', 'A=(cos(t),sin(t),t)', 'Curve(cos(t),sin(t),t,t,0,6.28)']
  const out = api.ensureVectorCalcDemoLines(text, badAi)
  assert(
    '柱面不被螺旋线劫持',
    out.some((l) => /x\^2\s*\+\s*y\^2\s*=/.test(l)) && !out.some((l) => /\bCurve\s*\(\s*cos/i.test(l)),
    out
  )
}
{
  const text = '上半球面 x^2+y^2+z^2=R^2 (z≥0)'
  const out = api.ensureVectorCalcDemoLines(text, ['r=Slider(1,5,0.1)'])
  assert(
    '半球补球面方程',
    out.some((l) => /x\^2\s*\+\s*y\^2\s*\+\s*z\^2/.test(l)),
    out
  )
}
{
  const text = '双纽线绕轴形成的空间实体 −h≤z≤h'
  const out = api.ensureVectorCalcDemoLines(text, ['a=Slider(1,3,0.1)'])
  assert(
    '双纽线实体含 z 范围',
    out.some((l) => /z\s*>=/.test(l)) && out.some((l) => /\^\s*2\s*<=|\)\^2\s*<=/.test(l) || /\(.*\)\^.*=/.test(l) || /\(x\^2/.test(l)),
    out
  )
}
{
  const text = '螺旋线 x=cost,y=sint,z=t'
  const out = api.ensureVectorCalcDemoLines(text, [])
  assert('螺旋线出 Curve', out.some((l) => /\bCurve\s*\(/i.test(l)), out)
}
{
  const text = '上半圆 ∫(x^2+y^2)ds'
  const out = api.ensureVectorCalcDemoLines(text, ['a=Slider(1,5,0.1)'])
  assert(
    '2D半圆不进3D曲线',
    out.some((l) => /A=\(a\*cos/.test(l)) && !out.some((l) => /,\s*t\)/.test(l) && /sin\(t\)/.test(l)),
    out
  )
}

console.log(failed ? `\nFAILED: ${failed}` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
