# GeoGebra API 速查（给 AI / 扩展用）

官方完整文档：https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/

本扩展嵌入的是 **Graphing**。AI 只应输出 **输入栏可执行的英文命令**（`evalCommand`），不要输出 JavaScript。

---

## 1. AI 应输出的输入栏命令（Graphing）

### 函数 / 曲线
```
f(x)=e^x
y=sin(x)
g(x)=e^a*(x-a)+e^a
h(x)=(-1/e^a)*(x-a)+e^a
f(x)=If(x!=0,(e^x-1)/x,1)
```

### 点
```
A=(0,1)
A=(a,e^a)
(2,3)
```
禁止：`Point((0,1))`

### 滑块（可拖参数必须用这个）
```
a=Slider(-2,5,0.1)
t=Slider(0,10,0.1)
```
完整形式：
`Slider(Min, Max, Increment, Speed, Width, IsAngle, Horizontal, Animating, Random)`

禁止只写 `a=0`（会变成普通数值，**没有滑块**）。需要初值时由扩展用 JS `setValue` 设置。

### 不等式（可画区域）
```
x^2 + y^2 <= 1
y > 2*x + 1
x >= 0
```
用 `<= >= < > !=`，不要用 `≤ ≥ ≠`。

### 几何常用
```
O=(0,0)
A=(3,0)
B=(0,4)
Vector(O,A)
Circle((0,0),1)
Circle(A,B)
Line(A,B)
Segment(A,B)
Polygon(A,B,C)
PerpendicularLine(A,Line(B,C))
Tangent(A,f)
```

### 写法硬规则
| 要 | 不要 |
|---|---|
| `e^x` / `exp(x)` | `Exp(x)` |
| `e^a*(x-a)` | `e^a(x-a)` |
| `(-1/e^a)*(x-a)` | `-1/e^a (x-a)` |
| `a=Slider(-2,5,0.1)` | `a=0`（当 a 要拖时） |
| `A=(0,1)` | `Point((0,1))` |
| `<= >=` | `≤ ≥` |
| 每行一条命令 | Markdown / 中文说明 / Limit / Solve |

### 不要输出（Graphing 易失败或无图）
`Limit` / `lim` / `Solve` / `NSolve` / `Integral` 结论式 / `Derivative` 纯 CAS 结果 / 教程文字

极限题 → 只输出函数本身，例如：`f(x)=If(x!=0,(e^x-1)/x,1)`

无内容时只输出：`%none`

---

## 1.1 线面积分演示（Graphing 2D 友好）

**原则：** 画路径 / 定向 / 场样本 / 投影域，**不算** `Integral` 数值。

### 平面线积分 \(\int_L P\,dx+Q\,dy\)
```
t=Slider(0,6.28,0.05)
A=(cos(t),sin(t))
S=(1,0)
P1=(1,0)
Q1=(1,0.6)
Vector(P1,Q1)
P2=(0,1)
Q2=(-0.6,1)
Vector(P2,Q2)
x^2+y^2<=1
```
- 闭曲线：参数扫一周 + 区域不等式（格林对照）
- 折线：`A=(0,0)` `B=(1,0)` `C=(1,1)` + `Line(A,B)` `Line(B,C)`（不要 `Segment`）

### 对弧长 \(\int_L f\,ds\)
路径滑块点即可；场样本可省略。强调与方向无关。

上半圆 \(x^2+y^2=a^2,\ y\ge0\)：
```
a=Slider(1,5,0.1)
t=Slider(0,pi,0.05)
A=(a*cos(t),a*sin(t))
S=(-a,0)
E=(a,0)
x^2+y^2=a^2
```
禁止只输出 `a=Slider(...)`。

### 面积分（降维）
曲面 → **投影域不等式** + **一个法向 `Vector`**：
```
x^2+y^2<=1
N0=(0,0)
N1=(0,0.8)
Vector(N0,N1)
```

### 空间曲线（`appName: '3d'` · helix）
```
t=Slider(0,6.28,0.05)
A=(cos(t),sin(t),t)
Curve(cos(t),sin(t),t,t,0,6.28)
```

### 柱面截段（`3d` · cylinder）
```
r=Slider(1,3,0.1)
h=Slider(0.5,4,0.1)
x^2+y^2=r^2
z=0
z=h
```

### 半球（`3d` · sphere）
```
r=Slider(1,5,0.1)
x^2+y^2+z^2=r^2
z>=0
```

### 空间实体 / 双纽线柱体（`3d` · solid）
```
a=Slider(1,3,0.1)
h=Slider(0.5,3,0.1)
(x^2+y^2)^2<=2*a^2*(x^2-y^2)
z>=-h
z<=h
```

### 禁止
`Integral` / `Segment` / `Polygon` / `&&` / 链式 `1<=f<=2` / 把柱面球面误写成螺旋线

题型分流：实体/柱面/球面优先于螺旋线；含 `z` 不等式也会进 3D。

---

## 2. JavaScript Apps API（扩展 `page-bridge` 用，AI 不直接输出）

获得 API：`appletOnLoad(api) { ... }` 或全局 `ggbApplet`

### 创建 / 清空
| 方法 | 作用 |
|---|---|
| `evalCommand(cmd)` | 执行输入栏命令，成功返回 true（可用 `\\n` 多条） |
| `evalCommandGetLabels(cmd)` | 同上，返回新建对象标签 |
| `evalLaTeX(latex)` / `evalLaTex(latex)` | 从 LaTeX 创建 |
| `evalCommandCAS(str)` | CAS（Graphing 慎用） |
| `reset()` | 重载初始构造 |
| `newConstruction()` | 清空全部对象 |
| `deleteObject(name)` | 删除对象 |
| `setErrorDialogsActive(false)` | 关掉错误弹窗（批量导入建议关） |

### 读写数值 / 坐标 / 可见性
| 方法 | 作用 |
|---|---|
| `setValue(name, number)` | 设滑块/数值（**比 `SetValue()` 命令可靠**） |
| `getValue(name)` | 读数值 |
| `setCoords(name, x, y)` | 设点坐标 |
| `getXcoord` / `getYcoord` | 读点坐标 |
| `setVisible(name, bool)` | 图形区显示/隐藏 |
| `getVisible(name)` | 是否可见 |
| `setFixed(name, fixed, selectionAllowed?)` | 固定 |
| `setColor(name, r, g, b)` | 颜色 0–255 |
| `setLabelVisible(name, bool)` | 标签 |
| `setTrace(name, bool)` | 轨迹 |
| `setAnimating(name, bool)` + `startAnimation()` / `stopAnimation()` | 动画 |
| `renameObject(old, new)` | 重命名 |
| `exists(name)` / `isDefined(name)` | 是否存在/有定义 |
| `getObjectType(name)` | 如 `"numeric"` `"point"` `"function"` |
| `getAllObjectNames([type])` | 全部对象名 |
| `getObjectNumber()` | 对象数量 |
| `getXML(name)` / `getXML()` | 读 XML（可查是否含 `<slider>`） |
| `getValueString(name)` / `getCommandString(name)` / `getLaTeXString(name)` | 字符串表示 |

### 视图 / 尺寸
| 方法 | 作用 |
|---|---|
| `setSize(w, h)` | 改 applet 像素尺寸（嵌入必用） |
| `setWidth` / `setHeight` | 单边尺寸 |
| `setCoordSystem(xmin,xmax,ymin,ymax)` | 坐标系范围 |
| `showAllObjects()` | 缩放到看见全部对象 |
| `setAxesVisible(x,y)` / `setGridVisible(bool)` | 轴/网格 |
| `setPerspective(str)` | 布局透视 |
| `showToolBar(bool)` / `showMenuBar(bool)` / `showAlgebraInput(bool)` | UI |
| `enableRightClick` / `enableShiftDragZoom` / `enableLabelDrags` | 交互 |
| `refreshViews()` | 刷新（清轨迹） |
| `undo()` / `redo()` / `setUndoPoint()` | 撤销 |

### 导出
| 方法 | 作用 |
|---|---|
| `getPNGBase64(scale, transparent, dpi?)` | 图形 PNG |
| `getScreenshotBase64(cb)` | 整 applet 截图 |
| `exportSVG(cb\|filename)` / `exportPDF(scale, cb)` | 矢量/PDF |

### 事件
`registerAddListener` / `registerRemoveListener` / `registerUpdateListener` / `registerClickListener` / `registerObjectUpdateListener` / `registerClientListener` 及对应 `unregister*`

---

## 3. 本扩展消息桥（content ↔ page-bridge）

content → 主世界：
```js
{ source: 'mtp-ext-content', type: 'MTP_RUN_GGB', requestId, lines: string[], width?, height? }
{ source: 'mtp-ext-content', type: 'MTP_GGB_RESIZE' }
{ source: 'mtp-ext-content', type: 'MTP_GGB_DESTROY' }
```

主世界 → content：
```js
{ source: 'mtp-page-bridge', type: 'MTP_BRIDGE_READY', ver }
{ source: 'mtp-page-bridge', type: 'MTP_GGB_DONE', requestId, ok, fail, imported?, skipped?, error? }
```

扩展自动行为：
1. 规范化：`Exp`→`exp`，`Point((x,y))`→`(x,y)`，补 `*`，`≤`→`<=`
2. 若 `a=0` 且被其它命令引用 → 升为 `a=Slider(min,max,0.1)`，再用 `api.setValue('a', 0)`
3. 过滤 Limit/Solve 等；嵌入时 `setSize` 对齐容器，**不** CSS 拉伸 canvas

---

## 4. 给 AI 的最小输出合同

只输出若干行，每行一条 Graphing 命令。示例：

```
f(x)=e^x
a=Slider(-2,5,0.1)
g(x)=e^a*(x-a)+e^a
A=(a,e^a)
h(x)=(-1/e^a)*(x-a)+e^a
```

---

## 5. 运行时实测：Graphing applet 方法名（245）

从本机嵌入的 Graphing `api` 枚举（含少量内部名）。**AI 仍只输出输入栏命令**；扩展侧常用加粗项。

### 创建 / 求值
`evalCommand` · `evalCommandGetLabels` · `asyncEvalCommand` · `asyncEvalCommandGetLabels` · `evalCommandCAS` · `evalGeoGebraCAS` · `evalLaTeX` · `evalMathML` · `evalXML` · `initCAS`

### 对象读写
`exists` · `isDefined` · `isIndependent` · `isMoveable` · `isFixed` · `isInteractive` · `isAnimating` · `isTracing` · `isSelectionAllowed` · `getObjectType` · `getObjectName` · `getObjectNumber` · `getAllObjectNames` · `getSiblingObjectNames` · `getObjectsOfItsGroup` · `getCASObjectNumber` · **`getValue`** · **`setValue`** · `getListValue` · `setListValue` · `setTextValue` · `getValueString` · `getDefinitionString` · `getCommandString` · `getLaTeXString` · `getLaTeXBase64` · `getXcoord` · `getYcoord` · `getZcoord` · **`setCoords`** · `setCorner` · **`deleteObject`** · `renameObject` · `setAuxiliary` · `groupObjects` · `ungroupObjects`

### 外观 / 可见
**`setVisible`** · `getVisible` · `setColor` · `getColor` · `setCaption` · `getCaption` · `setLabelVisible` · `getLabelVisible` · `setLabelStyle` · `getLabelStyle` · `setFixed` · `setTrace` · `setLayer` · `getLayer` · `setLayerVisible` · `setLineStyle` · `getLineStyle` · `setLineThickness` · `getLineThickness` · `setPointStyle` · `getPointStyle` · `setPointSize` · `getPointSize` · `setFilling` · `getFilling` · `setDisplayStyle` · `setFont` · `setOrdering` · `updateOrdering`

### 构造 / UI
**`reset`** · **`newConstruction`** · `updateConstruction` · `refreshViews` · `undo` · `redo` · `setUndoPoint` · `getConstructionSteps` · `setConstructionStep` · `nextConstructionStep` · `previousConstructionStep` · `setMode` · `getMode` · `getToolName` · `setCustomToolBar` · `addCustomTool` · `showToolBar` · `showMenuBar` · `showAlgebraInput` · `showResetIcon` · `enableRightClick` · `enableLabelDrags` · `enableShiftDragZoom` · `enableCAS` · `enable3D` · `hideCursorWhenDragging` · `setOnTheFlyPointCreationActive` · `setRepaintingActive` · **`setErrorDialogsActive`** · `setPerspective` · `getPerspectiveXML` · `setLanguage` · `setRounding` · `getRounding` · `setGlobalOptions` · `setAlgebraOptions` · `setGraphicsOptions` · `getGraphicsOptions` · `getViewProperties` · `setPointCapture` · `setAxesVisible` · `setAxisLabels` · `getAxisLabels` · `setAxisSteps` · `setAxisUnits` · `getAxisUnits` · `setGridVisible` · `getGridVisible` · **`setCoordSystem`** · `showAllObjects` · `recalculateEnvironments` · `previewRefresh` · `focus` · `showTooltip`

### 尺寸 / 全屏
**`setSize`** · `setWidth` · `setHeight` · `isFullScreenActive` · `exitFullScreen`

### 动画
`setAnimating` · `setAnimationSpeed` · `startAnimation` · `stopAnimation` · `isAnimationRunning`

### 导出 / 存取
`getPNGBase64` · `getScreenshotBase64` · `getThumbnailBase64` · `writePNGtoFile` · `exportSVG` · `exportPDF` · `exportGIF` · `exportPSTricks` · `exportPGF` · `exportAsymptote` · `exportCollada` · `exportSimple3d` · `exportConstruction` · `getBase64` · `setBase64` · `getXML` · `getStyleXML` · `getAlgorithmXML` · `setXML` · `getFileJSON` · `setFileJSON` · `openFile` · `openMaterial` · `checkSaved` · `isSaved` · `setSaved` · `copyTextToClipboard` · `getVersion` · `getScreenReaderOutput`

### 事件
`registerAddListener` · `unregisterAddListener` · `registerRemoveListener` · `unregisterRemoveListener` · `registerUpdateListener` · `unregisterUpdateListener` · `registerClickListener` · `unregisterClickListener` · `registerObjectUpdateListener` · `unregisterObjectUpdateListener` · `registerObjectClickListener` · `unregisterObjectClickListener` · `registerRenameListener` · `unregisterRenameListener` · `registerClearListener` · `unregisterClearListener` · `registerStoreUndoListener` · `unregisterStoreUndoListener` · `registerClientListener` · `unregisterClientListener` · `registerEmbedResolver`

### 其它（笔记/多用户/表格等，Graphing 少用）
`addImage` · `insertImage` · `insertEmbed` · `addGeoToTV` · `removeGeoFromTV` · `setValuesOfTV` · `showPointsTV` · `getPenColor` · `setPenColor` · `getPenSize` · `setPenSize` · `getPages` · `getActivePage` · `selectPage` · `setPageContent` · `getPageContent` · `handlePageAction` · `login` · `logout` · `addMultiuserSelection` · `removeMultiuserSelections` · `setLabelSuffixForMultiuser` · `lockTextElement` · `unlockTextElement` · `switchCalculator` · `getEmbeddedCalculators` · `getInputBoxState` · `setInputBoxState` · `getEditorState` · `setEditorState` · `translate` · `debug` · `remove` · …

内部/混淆短名可忽略：`De` `Dkb` `Ee` `Ekb` `Fe` `qmb` 等。
