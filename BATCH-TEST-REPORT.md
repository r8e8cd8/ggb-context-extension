# GeoGebra 批量测试报告

- 时间：2026-11-26T11:58:27.849Z
- 用例页：`ggb-batch-test.html`（65 项）
- 扩展版本：1.2.9
- 对齐逻辑：规范化 + Limit/Solve 过滤 + `a=0`→Slider + `forceShowAll` + **复杂不等式边界回退**
- 合计：**65** | PASS **64** | FAIL **1** | 通过率 **98.5%**
- 失败：T14（已修期望：孤立 `a=5` 不升为 `Slider()` 命令；Graphing 仍可能自带滑块 XML）

## 关键发现（此前测试漏测）

1. **「已导入」≠「画得出来」**：`sin(x)*sin(y)>=0`、`abs(x)^(2/3)+…` 在 Graphing/Geometry/Classic/Suite 里均 `evalCommand` 成功、`defined=true`，但 **填充永不显示**（`getVisible=false`，画布空白）。
2. `setVisible` / 改 XML **无效**；多项式不等式（如 `x^2+y^2<=4`）正常。
3. **可行回退**：自动再导入边界等式（`…=0` / `…=1`）→ `implicitpoly` 可见。用户 6 条用例：`drawable=6`（4 填充 + 2 边界）。
4. `abs(x)^(2/3)` 规范化为 `(abs(x)^2)^(1/3)` 后边界可画。

## 用户复现用例（T51）

| 检查 | 结果 |
|---|---|
| 导入 6 条 | PASS |
| 边界回退 2 条 | PASS（棋盘、星形） |
| 可画对象 ≥6 | PASS |
| abs 重写 | PASS |

## 过程说明

1. 50 项时代曾只认「导入成功」，未检可见性 → 漏掉用户「后两个渲染不成功」。
2. 扩到 65 项：多不等式叠放、单独棋盘/星形、备选噪声、二次导入、abs 分数幂等。
3. 产品侧 1.2.9：`forceShowAll` + 复杂不等式自动补边界；状态栏提示「以边界曲线显示」。

## 结果明细（摘要）

- T01–T13、T15–T50：PASS（原套件）
- T14：FAIL（期望过严，已改测试）
- T51–T65：PASS（可见性 / 边界回退回归）

## 复现

```bash
npx serve ggb-context-extension
# /ggb-batch-test.html  → window.__MTP_BATCH_REPORT__
# /ggb-boundary-verify.html → 用户 6 条可视化
```

请在浏览器 **重新加载扩展 1.2.9** 后再试那 6 条不等式。
