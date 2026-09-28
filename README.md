# 合成大奶娃

纯 **HTML + CSS + JavaScript** 的静态网页小游戏，零依赖、零构建、离线可玩。
物理引擎（PBD 位置约束求解）是自己写的，没有引入 matter.js 等任何第三方库。

![预览](preview.png)

## 玩法

- **鼠标**：移动瞄准，点击即投放。
- **触屏**：按住拖动瞄准，**松手才投放**——手指不会挡住落点，也方便微调。
- 两个**同级别**的碰到一起就合成为高一级，并获得分数。
- 顶上虚线是**警戒线**：越线超过 1.5 秒即判负。
- 结束后可以填昵称，把成绩提交到**在线排行榜**（见下）。
- `←` `→` 微调位置，`Space` / `Enter` 投放，`R` 重新开始。

合成链（11 级）：

```
葡萄 → 樱桃 → 橘子 → 柠檬 → 猕猴桃 → 番茄 → 桃子 → 菠萝 → 椰子 → 半西瓜 → 大西瓜
```

合成得分采用三角数：1 / 3 / 6 / 10 / 15 / 21 / 28 / 36 / 45 / 55，
两个大西瓜撞在一起会一起消失并额外加 100 分。

## 运行

直接双击 `index.html` 即可（`file://` 协议下没有任何网络请求）。
也可以起个静态服务：

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构：棋盘、结束遮罩、侧边面板、排行榜弹窗 |
| `style.css` | 全部样式：玻璃拟态面板、响应式布局、结束动画、排行榜 |
| `game.js` | 游戏逻辑 + 自研物理 + Canvas 渲染 + WebAudio 音效 |
| `leaderboard.js` | 在线排行榜（TinyWebDB 接口 + 弹窗渲染） |
| `assets/fruits/` | 11 张统一后的水果贴图（512×512 PNG，透明底）+ `parts.js` 碰撞形状 |
| `tools/normalize_assets.py` | 素材统一脚本：抠底、去噪、统一画布、烤暗边 |
| `tools/build_parts.py` | 按贴图轮廓生成碰撞形状，产出 `assets/fruits/parts.js` |
| `src/` | 原始素材（11 张，格式/尺寸/底色都不统一），只作为脚本输入 |
| `physics.test.js` | 物理手感自检脚本（`node physics.test.js`） |
| `preview.png` | 预览图 |

## 排行榜

用的是 **TinyWebDB**（`https://tinywebdb.appinventor.space/api`）——一个给 App Inventor 用的
极简 key-value 云存储，靠 POST 表单调用，跨域头是 `Access-Control-Allow-Origin: *`，
所以**纯静态页也能直接读写**，不需要自建后端。

| 项 | 值 |
| --- | --- |
| 接口 | `POST https://tinywebdb.appinventor.space/api` |
| 账号 | `user=danaiwa` / `secret=6f52518c` |
| 用到的 action | `update`（写）、`search`（按 tag 前缀读）、`delete`（删） |
| tag | `dnw_<时间戳36进制>_<随机4位>` |
| value | `{"n":"昵称","s":分数,"t":时间戳}` |

读榜就是 `action=search&tag=dnw_&type=both&count=100`，拿回一个 `{tag: value}` 的字典，
本地 `JSON.parse` 后按分数排序取前 20。

```js
// 提交
POST user=danaiwa&secret=6f52518c&action=update
     &tag=dnw_mukuffr8_435q
     &value={"n":"奶娃大王","s":4321,"t":1759000000000}

// 读榜
POST user=danaiwa&secret=6f52518c&action=search&no=1&count=100&tag=dnw_&type=both
→ {"dnw_mukuffr8_435q":"{\"n\":\"奶娃大王\",\"s\":4321,\"t\":1759000000000}"}
```

实现上的几个小处理：

- **昵称**存 `localStorage`，下次自动带出来；去掉控制字符、限长 12 字；
- **防手抖**：两次提交至少间隔 3 秒，0 分不上榜，分数明显离谱（> 99999999）的不收；
- **容错**：网络不通只是排行榜打不开，游戏照常玩；返回不是 JSON 会给出可读的错误提示；
- **XSS**：榜单全部用 `textContent` 渲染，不拼 HTML；
- 接口单次最多返回 100 条，所以榜单是「最近 100 条里排前 20」，弹窗底部有标注。

换账号：改 `leaderboard.js` 顶部的 `USER` / `SECRET` / `PREFIX` 即可（换 `PREFIX` 相当于另开一个榜）。

## 碰撞形状（不是圆）

**每个水果的碰撞箱按贴图轮廓来**：`tools/build_parts.py` 读 `assets/fruits/*.png` 的 alpha，
用一组**内接小圆**铺满轮廓，写出 `assets/fruits/parts.js`：

```js
window.SUIKA_PARTS = [ { rb: 1.083, parts: [[0.012,-0.31,0.42], ...] }, ... ];
// parts = [ox, oy, s]，单位是「以 r 为 1」；rb = 包围圆半径（快速粗筛用）
```

游戏里球的碰撞就是这些子圆：

| 环节 | 做法 |
| --- | --- |
| 粗筛 | 两个水果的包围圆 `rb` 不相交直接跳过 |
| 球球 | 子圆两两求交，取**最深/最近的那一对**产生法线与修正量，推力按逆质量分配到刚体中心 |
| 合成 | 任意一对子圆「贴上」（含 0.8px 容差）即合成 |
| 撞墙 | 每个子圆各自贴墙，取各方向最深穿透量一次性加到刚体中心上 |
| 旋转 | 子圆跟着刚体 `angle` 一起转，所以形状会随滚动改变落点 |

圆一律取**内接**（半径 = 到轮廓的欧氏距离，用 chamfer 距离变换算），
所以**不会出现"看不见的碰撞"**；覆盖率不够的地方再贪心补圆，覆盖率到 97% 就提前收工。

实测贴合度（IoU，1.0 = 与图片完全一致）：

```
tier  0   1   2   3   4   5   6   7   8   9  10
IoU .94 .96 .95 .92 .85 .90 .81 .96 .94 .96 .78   ← 平均 0.91
超出轮廓 ≤1.2%（几乎为零）  圆个数 9~16（形状简单自动用更少）
```

`parts.js` 缺失或某级没数据时，自动退回成单圆（半径 r），行为与旧版一致，不会白屏。

重新生成（换了贴图之后跑一次）：

```bash
python tools/build_parts.py --max-parts 16 --preview
# --preview 会导出 _parts_preview.png：红=图片轮廓 绿=碰撞箱 黄=重合
```

成本：12~30 个水果在场时，整套物理每帧 **0.14~0.34 ms**（60fps 预算是 16.7ms）。

## 素材（换图）

11 级各对应 `assets/fruits/NN-<名字>.png` 一张，**棋盘、下一个预览、合成表、粒子全部复用同一张**，
不需要做多倍图（不同尺寸由 canvas 缩放）：

```
01-grape       02-cherry    03-orange   04-lemon    05-kiwi      06-tomato
07-peach       08-pineapple 09-coconut  10-halfmelon 11-watermelon
```

规格：**512×512 正方形、PNG-32 透明底、主体居中占长边 92%**，贴图会跟着水果一起滚动/旋转。

换图的两种方式：

1. **偷懒**：直接把新图命名成上面的文件名丢进 `assets/fruits/` 覆盖即可
   （脚本已经统一过格式，直接可用）。
2. **正规**：把 11 张原始图按 `src/1..11.*`（jpg/png/webp 混着都行）放好，然后跑

```bash
python tools/normalize_assets.py
```

脚本会：从四边向内**区域生长抠底**、丢掉零碎噪点、填掉主体内部小孔、
裁剪并按长边 92% 居中到统一画布、最后在主体底下**烤一圈柔和暗边**
（浅色角色在奶油色棋盘上才分得清，运行时零开销），并把每级的平均色打印出来
（可填进 `FRUITS` 的 `pc1/pc2` 作为粒子颜色）。

三道闸门可按图切换，`tools/normalize_assets.py` 顶部 `CFG` 里逐张配置：

| 闸门 | 作用 | 用在 |
| --- | --- | --- |
| `sat_max` | 饱和度高于它的像素永不算背景 | 浅底图（1~10） |
| `lum_min` | 亮度高于它的像素永不算背景（深底反向） | 星空底（11） |
| `val_min` | 最暗通道低于它的像素永不算背景 | 9 号「接近白但非纯白」的翅膀 |

> 9 号天使的白翅膀是 223~241，背景是纯白 253~255。只靠饱和度闸门时翅膀会被判成背景，
> 只剩一圈碎渣，缩放旋转后糊成一大块米色色块；加上 `val_min=246` 后翅膀被完整保住。

**缺图不影响游玩**：任何一张加载失败都会自动回退成程序化绘制的圆形水果（`FRUITS[i].c1/c2`）。

## 实现要点

- **物理**：位置约束求解（PBD）。每帧 3 个子步 × 6 次迭代，
  每个水果带一组按图片轮廓生成的子圆（见上一节），
  速度由位置差反推 —— 堆叠稳定、不抖动，且能正确处理 124px 大西瓜压在 17px 葡萄上的极端质量比。
- **Q 弹回弹**：位置约束会把法向速度吃掉，所以在每个子步末尾额外做一次弹性冲量，
  把法向相对速度直接改写成 `e × 碰撞前速度`（球球 `e=0.38`、墙 `e=0.45`），
  回弹量只由 `e` 决定、不受子步/迭代次数影响。
  撞速低于 `REST_THRESHOLD` 时完全不弹，所以静止堆叠依然零抖动：
  从顶部掉落的水果能弹起约 110px、连弹 5 次才停。
  另外撞击时按法线做挤压变形（压扁 + 垂直拉伸，0.4 秒回弹），果冻感更强。
- **合成判定**：接触容差 0.8px，同级别贴身即合，手感跟手；
  合成只在每个子步的第 0 次迭代判定一次，避免重复合成。
- **渲染**：整体按 devicePixelRatio 缩放。有贴图就画贴图（`box = 2r / 0.92`，
  保证**视觉大小 = 物理直径**，四边不会露馅），没贴图就画程序化水果。
  贴图跟着 `b.angle` 一起旋转，和物理滚动一致；撞击时的挤压变形同样作用于贴图。
  合成时有粒子爆裂、飘分文字与新品弹出动画。
- **素材加载**：等 `img.decode()` 完成才交给 `drawImage`，避免画出没解码完的半成品。
- **音效**：WebAudio 振荡器实时合成，无音频文件；可一键静音并记忆设置。
- **存档**：最高分与静音状态存 `localStorage`。
- **调试**：控制台可用 `__SUIKA__.state`、`__SUIKA__.reset()`、`__SUIKA__.drop()`、
  `__SUIKA__.FRUITS`、`__SUIKA__.render()`。

## 物理自检

```bash
node physics.test.js
```

用桩件模拟 DOM/Canvas，在 Node 里跑真物理（连 `parts.js` 一起加载，用的是真实碰撞形状），覆盖：
自由落体回弹高度、球对球弹起、12 秒堆叠稳定性（残余速度 / 漂移 / 穿墙 / NaN）、
**静止后形状之间无穿透**、自动投放 60 次不走样、触屏「拖动瞄准 / 松手投放」与鼠标「按下即投」两套输入。

```bash
python tools/build_parts.py --max-parts 16 --preview   # 换了贴图后重新生成碰撞形状
node physics.test.js                                   # 物理自检
```

## 手机端适配

| 项 | 做法 |
| --- | --- |
| 布局 | 窄屏（≤860px）下 `.panel` 用 `order:-1` 提到棋盘上方，横过来压成**顶部信息条**：左边分数、右边按钮，标题/合成表/提示收起 |
| 棋盘尺寸 | `height: min(可用高度, 96vw × 700/420)`，宽度由 `aspect-ratio` 反推 —— 不拉伸、不溢出，任何机型都不出滚动条 |
| 视口高度 | 用 `100dvh`（带 `100vh` 回退），避开手机地址栏吃掉高度的问题 |
| 安全区 | `padding` 叠 `env(safe-area-inset-*)`，刘海 / 小白条不会压住内容 |
| 触控 | 棋盘 `touch-action:none`；`body` 上 `touch-action:manipulation` + `overscroll-behavior:none`，干掉双击缩放和下拉刷新 |
| 按钮 | 最小 46px 高、带内边距，小屏（≤380px）再压一档；`pointerdown` 时 `setPointerCapture`，手指滑出棋盘也能收到 `pointerup` |
| 反馈 | 合成时按等级给 `navigator.vibrate` 轻震（跟随静音开关） |
| 性能 | canvas 内部分辨率按 `devicePixelRatio` 缩放但**封顶 2×**，高分屏不炸填充率 |
| 弹窗 | 结束弹窗按钮撑满宽度、加大触摸目标 |

横屏（`orientation: landscape`）自动切回左右布局：棋盘占满高度、信息条竖排在右侧。

## 参数速查（`game.js` 顶部）

| 常量 | 默认值 | 作用 |
| --- | --- | --- |
| `GRAVITY` | `2600` | 重力加速度 px/s² |
| `SUBSTEPS` / `ITER` | `3` / `6` | 物理精度，调高更稳更费 CPU |
| `RESTITUTION` | `0.38` | 球与球之间的弹性，调大更弹 |
| `WALL_RESTITUTION` | `0.45` | 撞墙 / 撞地面的弹性 |
| `REST_THRESHOLD` | `55` | 撞速低于此值不反弹（保堆叠稳定） |
| `FRICTION` | `0.955` | 接触切向摩擦，调小更滑、调大更快停住 |
| `SQUASH_MAX` / `SQUASH_DECAY` | `0.30` / `9` | 撞击挤压的最大变形与回弹速度 |
| `DROP_MS` | `360` | 两次投放的最小间隔 |
| `OVER_LIMIT` | `1.5` | 越线判负秒数 |
| `DANGER_Y` | `142` | 警戒线高度 |
| `MERGE_PAD` | `0.8` | 合成接触容差（子圆之间） |
| `ASSET_FILL` | `0.92` | 贴图主体占画布比例，**必须与生成脚本的 `FILL` 一致** |
| `FRUITS` | 11 项 | 每级的半径 / 贴图路径 / 兜底配色，改这里即可换皮 |
| `FRUITS[i].c1/c2` | 11 组 | 贴图缺失时的程序化水果配色 |
| `FRUITS[i].pc1/pc2` | 11 组 | 粒子/汁水颜色（取自贴图主体平均色） |

## 参考的开源项目

本项目的玩法与水果链设计参考了以下开源实现（代码为本仓库原创，未复制其源码）：

- [Ikapricity/daxigua](https://github.com/Ikapricity/daxigua) — 合成大西瓜未修改版本源码，可直接在浏览器运行
- [CaptainAries/dxg](https://github.com/CaptainAries/dxg)
- [moonfloof/suika-game](https://github.com/moonfloof/suika-game) — 使用 matter.js 的英文版克隆
- [IceburgLettuce17/suika-game-js-beta](https://github.com/IceburgLettuce17/suika-game-js-beta)

## 许可

仅供学习娱乐使用。
